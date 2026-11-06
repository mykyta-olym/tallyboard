// Turns the raw yearly CSV files into static/data/quakes.parquet and records what
// happened in data/manifest.json. The output is byte-for-byte repeatable for the
// same raw files.
//
//   node scripts/data/build-parquet.ts
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import {
	COORDINATE_DECIMALS,
	DEPTH_DECIMALS,
	END_YEAR,
	MAGNITUDE_DECIMALS,
	MANIFEST_PATH,
	MIN_MAGNITUDE,
	NETWORKS,
	PARQUET_PATH,
	RAW_DIR,
	REGION_OVERRIDES,
	RETRIEVED_PATH,
	START_YEAR,
	USGS_ENDPOINT,
} from "./config.ts";

const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;

const networkList = NETWORKS.map(quote).join(", ");
const overrides = Object.entries(REGION_OVERRIDES)
	.map(([from, to]) => `WHEN ${quote(from)} THEN ${quote(to)}`)
	.join(" ");

const instance = await DuckDBInstance.create(":memory:", { threads: "1" });
const connection = await instance.connect();
const rows = async (sql: string) => (await connection.runAndReadAll(sql)).getRowObjectsJson();

// Every column is read as text first. Type guessing per file would otherwise pick
// different types for sparse columns, and timestamps would pick up the local zone.
await connection.run(`
	CREATE TABLE raw AS
	SELECT * FROM read_csv('${RAW_DIR}/*.csv', header = true, all_varchar = true)
`);

await connection.run(`
	CREATE TABLE clean AS
	WITH typed AS (
		SELECT *, regexp_replace(
			regexp_replace(place, '^(The )?[0-9]{4} ', ''),
			'[, ]*([Ee]arthquake|Aftershock)$', ''
		) AS label
		FROM raw
		WHERE type = 'earthquake'
			AND net IN (${networkList})
			AND mag::DOUBLE >= ${MIN_MAGNITUDE}
	)
	SELECT
		id,
		replace(replace(time, 'T', ' '), 'Z', '')::TIMESTAMP AS time,
		round(latitude::DOUBLE, ${COORDINATE_DECIMALS})::DECIMAL(7, ${COORDINATE_DECIMALS}) AS latitude,
		round(longitude::DOUBLE, ${COORDINATE_DECIMALS})::DECIMAL(7, ${COORDINATE_DECIMALS}) AS longitude,
		round(depth::DOUBLE, ${DEPTH_DECIMALS})::DECIMAL(6, ${DEPTH_DECIMALS}) AS depth,
		round(mag::DOUBLE, ${MAGNITUDE_DECIMALS})::DECIMAL(4, ${MAGNITUDE_DECIMALS}) AS mag,
		lower(magType) AS mag_type,
		place,
		CASE
			WHEN regexp_matches(split_part(label, ', ', -1), '^[0-9]+ km ') THEN 'Unknown'
			ELSE CASE split_part(label, ', ', -1) ${overrides}
				ELSE regexp_replace(split_part(label, ', ', -1), ' region$', '')
			END
		END AS region
	FROM typed
`);

mkdirSync(dirname(PARQUET_PATH), { recursive: true });
await connection.run(`
	COPY (SELECT * FROM clean ORDER BY time, id) TO ${quote(PARQUET_PATH)} (
		FORMAT parquet,
		COMPRESSION zstd,
		COMPRESSION_LEVEL 22,
		PARQUET_VERSION V2,
		ROW_GROUP_SIZE 1000000
	)
`);

const [rawStats] = await rows("SELECT count(*) AS rows FROM raw");
const [cleanStats] = await rows(`
	SELECT
		count(*) AS rows,
		count(DISTINCT id) AS distinct_ids,
		count(DISTINCT region) AS regions,
		min(time)::VARCHAR AS first_event,
		max(time)::VARCHAR AS last_event,
		min(mag)::DOUBLE AS min_mag,
		max(mag)::DOUBLE AS max_mag,
		min(depth)::DOUBLE AS min_depth,
		max(depth)::DOUBLE AS max_depth
	FROM clean
`);
const excluded = await rows(`
	SELECT net, count(*)::INTEGER AS rows
	FROM raw
	WHERE net NOT IN (${networkList})
	GROUP BY net
	ORDER BY rows DESC, net
`);
const belowMinimum = await rows(`
	SELECT count(*)::INTEGER AS rows FROM raw
	WHERE net IN (${networkList}) AND mag::DOUBLE < ${MIN_MAGNITUDE}
`);

if (cleanStats?.rows !== cleanStats?.distinct_ids) throw new Error("duplicate event ids");

const parquet = readFileSync(PARQUET_PATH);
const manifest = {
	source: {
		name: "USGS ANSS Comprehensive Earthquake Catalog (ComCat), FDSN event web service",
		endpoint: USGS_ENDPOINT,
		retrieved: readFileSync(RETRIEVED_PATH, "utf8").trim(),
	},
	slice: {
		years: [START_YEAR, END_YEAR],
		min_magnitude: MIN_MAGNITUDE,
		event_type: "earthquake",
		networks: NETWORKS,
	},
	counts: {
		raw_rows: Number(rawStats?.rows),
		kept_rows: Number(cleanStats?.rows),
		excluded_by_network: excluded,
		below_minimum_magnitude: belowMinimum[0]?.rows,
	},
	ranges: {
		first_event_utc: cleanStats?.first_event,
		last_event_utc: cleanStats?.last_event,
		magnitude: [cleanStats?.min_mag, cleanStats?.max_mag],
		depth_km: [cleanStats?.min_depth, cleanStats?.max_depth],
		distinct_regions: Number(cleanStats?.regions),
	},
	parquet: {
		path: PARQUET_PATH,
		bytes: statSync(PARQUET_PATH).size,
		sha256: createHash("sha256").update(parquet).digest("hex"),
	},
};
writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, "\t")}\n`);
console.log(JSON.stringify(manifest.counts), manifest.parquet);
