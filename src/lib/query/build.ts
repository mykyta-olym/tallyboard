// Builds every SQL statement the dashboard runs. The same functions run in the
// browser on DuckDB-WASM and at build time on native DuckDB, which is how the
// static snapshot stays identical to what the live engine returns.
import type { Dimension, Filters } from "../filters.ts";
import { monthEnd } from "../filters.ts";
import { literal, numeric } from "./sql.ts";

export const TABLE = "quakes";

/** Bin widths. Each chart states its own so the SQL and the axis cannot disagree. */
export const MAG_BIN = 0.1;
export const DEPTH_BIN = 5;
export const MAP_CELL = 2;

/**
 * The global catalog is cut off at M4.5, so the histogram peak sits on the cutoff
 * and says nothing about completeness. The estimate never goes below this floor.
 */
export const MIN_COMPLETENESS = 5;
export const MIN_FIT_EVENTS = 50;

/** Depths USGS assigns when a real depth cannot be determined. */
export const FIXED_DEPTHS = [10, 33] as const;

export const EVENT_COLUMNS = [
	"time",
	"mag",
	"mag_type",
	"depth",
	"region",
	"place",
	"latitude",
	"longitude",
	"id",
] as const;
export type EventColumn = (typeof EVENT_COLUMNS)[number];

export interface Sort {
	column: EventColumn;
	descending: boolean;
}

export const DEFAULT_SORT: Sort = { column: "mag", descending: true };

export const PAGE_SIZE = 50;

/** One WHERE condition per active dimension, except the one left out. */
export function conditions(filters: Filters, omit?: Dimension): string[] {
	const out: string[] = [];
	if (filters.months && omit !== "months") {
		out.push(
			`time >= TIMESTAMP ${literal(`${filters.months.from}-01`)}`,
			`time < TIMESTAMP ${literal(monthEnd(filters.months.to))}`,
		);
	}
	if (filters.mag && omit !== "mag") {
		out.push(
			`mag BETWEEN ${numeric(filters.mag[0])} AND ${numeric(filters.mag[1])}`,
		);
	}
	if (filters.depth && omit !== "depth") {
		out.push(
			`depth BETWEEN ${numeric(filters.depth[0])} AND ${numeric(filters.depth[1])}`,
		);
	}
	if (filters.box && omit !== "box") {
		const { west, south, east, north } = filters.box;
		out.push(`latitude BETWEEN ${numeric(south)} AND ${numeric(north)}`);
		out.push(
			west <= east
				? `longitude BETWEEN ${numeric(west)} AND ${numeric(east)}`
				: `(longitude >= ${numeric(west)} OR longitude <= ${numeric(east)})`,
		);
	}
	if (filters.regions.length && omit !== "regions") {
		out.push(`region IN (${filters.regions.map(literal).join(", ")})`);
	}
	return out;
}

/** A WHERE clause, or an empty string when nothing is filtered. */
export function where(filters: Filters, omit?: Dimension): string {
	const parts = conditions(filters, omit);
	return parts.length ? `WHERE ${parts.join("\n  AND ")}` : "";
}

const lines = (...parts: string[]) => parts.filter(Boolean).join("\n");

export function summaryQuery(filters: Filters): string {
	const fixed = FIXED_DEPTHS.map(numeric).join(", ");
	return lines(
		"WITH f AS (",
		`  SELECT * FROM ${TABLE}`,
		`  ${where(filters)}`,
		"), top AS (",
		"  SELECT mag FROM f ORDER BY mag DESC, time, id LIMIT 10",
		"), largest AS (",
		"  SELECT id, mag, place, strftime(time, '%Y-%m-%d') AS day",
		"  FROM f ORDER BY mag DESC, time, id LIMIT 1",
		")",
		"SELECT",
		"  (SELECT count(*) FROM f)::INTEGER AS events,",
		"  (SELECT strftime(min(time), '%Y-%m-%d') FROM f) AS first_day,",
		"  (SELECT strftime(max(time), '%Y-%m-%d') FROM f) AS last_day,",
		"  (SELECT mag FROM largest) AS largest_mag,",
		"  (SELECT place FROM largest) AS largest_place,",
		"  (SELECT day FROM largest) AS largest_day,",
		"  (SELECT id FROM largest) AS largest_id,",
		"  (SELECT median(depth) FROM f)::DOUBLE AS median_depth,",
		"  (SELECT sum(pow(10, 1.5 * mag + 4.8)) FROM f) AS energy_joules,",
		"  (SELECT sum(pow(10, 1.5 * mag + 4.8)) FROM top)",
		"    / (SELECT sum(pow(10, 1.5 * mag + 4.8)) FROM f) AS top_ten_energy,",
		`  (SELECT count(*) FILTER (WHERE depth IN (${fixed}))::DOUBLE / nullif(count(*), 0) FROM f) AS fixed_depth_share`,
	);
}

/**
 * Gutenberg-Richter fit with Aki's maximum likelihood estimate and Utsu's
 * correction for binned magnitudes. Completeness comes from maximum curvature
 * plus 0.2, floored at MIN_COMPLETENESS. Leaves the magnitude filter out so the
 * numbers describe the same distribution the magnitude chart draws.
 */
export function fitQuery(filters: Filters): string {
	return lines(
		"WITH f AS (",
		`  SELECT mag FROM ${TABLE}`,
		`  ${where(filters, "mag")}`,
		"), peak AS (",
		"  SELECT round(mag, 1) AS m FROM f",
		"  GROUP BY 1 ORDER BY count(*) DESC, m LIMIT 1",
		"), c AS (",
		`  SELECT greatest(${numeric(MIN_COMPLETENESS)}, m + 0.2) AS mc FROM peak`,
		"), g AS (",
		"  SELECT c.mc, count(*)::INTEGER AS n, avg(f.mag) AS mean",
		"  FROM f, c WHERE round(f.mag, 1) >= c.mc GROUP BY c.mc",
		")",
		"SELECT mc, n,",
		`  CASE WHEN n >= ${numeric(MIN_FIT_EVENTS)} AND mean > mc - 0.05`,
		"    THEN log10(exp(1)) / (mean - (mc - 0.05)) END AS b",
		"FROM g",
	);
}

export function timelineQuery(filters: Filters): string {
	return lines(
		"SELECT strftime(date_trunc('month', time), '%Y-%m') AS month,",
		"  count(*)::INTEGER AS events",
		`FROM ${TABLE}`,
		where(filters, "months"),
		"GROUP BY 1 ORDER BY 1",
	);
}

export function magnitudeQuery(filters: Filters): string {
	return lines(
		"SELECT round(mag, 1) AS mag, count(*)::INTEGER AS events,",
		"  (sum(count(*)) OVER (ORDER BY round(mag, 1) DESC))::INTEGER AS at_least",
		`FROM ${TABLE}`,
		where(filters, "mag"),
		"GROUP BY 1 ORDER BY 1",
	);
}

export function depthQuery(filters: Filters): string {
	const bin = numeric(DEPTH_BIN);
	return lines(
		`SELECT (floor(depth / ${bin}) * ${bin})::INTEGER AS depth,`,
		"  count(*)::INTEGER AS events",
		`FROM ${TABLE}`,
		where(filters, "depth"),
		"GROUP BY 1 ORDER BY 1",
	);
}

export function mapQuery(filters: Filters): string {
	const cell = numeric(MAP_CELL);
	return lines(
		`SELECT (floor(latitude / ${cell}) * ${cell})::INTEGER AS lat,`,
		`  (floor(longitude / ${cell}) * ${cell})::INTEGER AS lon,`,
		"  count(*)::INTEGER AS events",
		`FROM ${TABLE}`,
		where(filters, "box"),
		"GROUP BY 1, 2 ORDER BY 1, 2",
	);
}

/** The top regions by count. Regions in the filter stay listed even when small. */
export function regionsQuery(filters: Filters, top = 10): string {
	const keep = filters.regions.length
		? ` OR region IN (${filters.regions.map(literal).join(", ")})`
		: "";
	return lines(
		"SELECT region, count(*)::INTEGER AS events",
		`FROM ${TABLE}`,
		where(filters, "regions"),
		"GROUP BY 1",
		`QUALIFY row_number() OVER (ORDER BY count(*) DESC, region) <= ${numeric(top)}${keep}`,
		"ORDER BY events DESC, region",
	);
}

export function regionNamesQuery(): string {
	return `SELECT region FROM ${TABLE} GROUP BY 1 ORDER BY count(*) DESC, region`;
}

function eventSelect(filters: Filters, sort: Sort): string {
	if (!EVENT_COLUMNS.includes(sort.column)) {
		throw new RangeError(`unknown column: ${String(sort.column)}`);
	}
	const direction = sort.descending ? "DESC" : "ASC";
	return lines(
		"SELECT strftime(time, '%Y-%m-%d %H:%M:%S') AS time, mag, mag_type,",
		"  depth, region, place, latitude, longitude, id",
		`FROM ${TABLE}`,
		where(filters),
		`ORDER BY ${TABLE}.${sort.column} ${direction}, ${TABLE}.id`,
	);
}

export function eventsQuery(filters: Filters, sort: Sort, page = 0): string {
	return lines(
		eventSelect(filters, sort),
		`LIMIT ${numeric(PAGE_SIZE)} OFFSET ${numeric(page * PAGE_SIZE)}`,
	);
}

/** Every matching event, for CSV export. */
export function exportQuery(filters: Filters, sort: Sort): string {
	return eventSelect(filters, sort);
}

/** The queries behind one refresh of the board. */
export function boardQueries(filters: Filters, sort: Sort, page = 0) {
	return {
		summary: summaryQuery(filters),
		fit: fitQuery(filters),
		timeline: timelineQuery(filters),
		magnitude: magnitudeQuery(filters),
		depth: depthQuery(filters),
		map: mapQuery(filters),
		regions: regionsQuery(filters),
		events: eventsQuery(filters, sort, page),
	};
}

export type BoardQuery = keyof ReturnType<typeof boardQueries>;
