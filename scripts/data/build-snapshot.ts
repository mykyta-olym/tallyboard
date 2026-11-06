// Runs the dashboard's own queries on native DuckDB and stores the unfiltered
// result. The page ships with these numbers, so it shows real charts before the
// engine has loaded and keeps them if the engine fails. A browser test compares
// them with what DuckDB-WASM returns.
//
//   node scripts/data/build-snapshot.ts
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { DuckDBInstance } from "@duckdb/node-api";
import type { BoardData, Snapshot } from "../../src/lib/board.ts";
import { NO_FILTERS } from "../../src/lib/filters.ts";
import { boardQueries, DEFAULT_SORT, regionNamesQuery } from "../../src/lib/query/build.ts";
import { loadTableSql } from "../../src/lib/query/table.ts";
import { PARQUET_PATH } from "./config.ts";

const OUT = "src/lib/data/snapshot.json";

const instance = await DuckDBInstance.create(":memory:", { threads: "1" });
const connection = await instance.connect();
await connection.run(loadTableSql(PARQUET_PATH));

async function rows<T>(sql: string): Promise<T[]> {
	const reader = await connection.runAndReadAll(sql);
	return reader.getRowObjectsJS() as T[];
}

const queries = boardQueries(NO_FILTERS, DEFAULT_SORT);
const [summary] = await rows<BoardData["summary"]>(queries.summary);
const [fit] = await rows<NonNullable<BoardData["fit"]>>(queries.fit);
if (!summary) throw new Error("the summary query returned nothing");

const board: BoardData = {
	summary,
	fit: fit ?? null,
	timeline: await rows(queries.timeline),
	magnitude: await rows(queries.magnitude),
	depth: await rows(queries.depth),
	map: await rows(queries.map),
	regions: await rows(queries.regions),
	events: await rows(queries.events),
};
const names = await rows<{ region: string }>(regionNamesQuery());

const snapshot: Snapshot = {
	parquetSha256: createHash("sha256").update(readFileSync(PARQUET_PATH)).digest("hex"),
	totalEvents: summary.events,
	regionNames: names.map((row) => row.region),
	board,
};
writeFileSync(OUT, `${JSON.stringify(snapshot)}\n`);
console.log(`${OUT}: ${summary.events} events, ${snapshot.regionNames.length} regions`);
