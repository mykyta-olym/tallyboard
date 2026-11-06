// The dashboard state as a query string. Links are shared, so parsing assumes
// nothing: a bad value is dropped and the rest of the link still works.
import type { Box, Filters, MonthRange, Range } from "./filters.ts";
import {
	DOMAIN,
	NO_FILTERS,
	tidyBox,
	tidyMonths,
	tidyRange,
	tidyRegions,
} from "./filters.ts";
import type { EventColumn, Sort } from "./query/build.ts";
import { DEFAULT_SORT, EVENT_COLUMNS } from "./query/build.ts";

export interface BoardState {
	filters: Filters;
	sort: Sort;
	sql: string | null;
}

export const MAX_SHARED_SQL = 4000;

export const DEFAULT_STATE: BoardState = {
	filters: NO_FILTERS,
	sort: DEFAULT_SORT,
	sql: null,
};

function parsePair(text: string | null, domain: Range): Range | null {
	if (!text) return null;
	const parts = text.split(",");
	if (parts.length !== 2 || parts.some((part) => part.trim() === "")) {
		return null;
	}
	return tidyRange(Number(parts[0]), Number(parts[1]), domain);
}

function parseMonths(
	from: string | null,
	to: string | null,
): MonthRange | null {
	if (!from && !to) return null;
	return tidyMonths(from ?? DOMAIN.firstMonth, to ?? DOMAIN.lastMonth);
}

function parseBox(text: string | null): Box | null {
	if (!text) return null;
	const parts = text.split(",");
	if (parts.length !== 4 || parts.some((part) => part.trim() === "")) {
		return null;
	}
	const [west, south, east, north] = parts.map(Number) as [
		number,
		number,
		number,
		number,
	];
	return tidyBox({ west, south, east, north });
}

function parseSort(text: string | null): Sort {
	if (!text) return DEFAULT_SORT;
	const [column, direction, extra] = text.split(".");
	const known = (EVENT_COLUMNS as readonly string[]).includes(column ?? "");
	if (!known || extra !== undefined) return DEFAULT_SORT;
	if (direction !== "asc" && direction !== "desc") return DEFAULT_SORT;
	return { column: column as EventColumn, descending: direction === "desc" };
}

export function parseState(params: URLSearchParams): BoardState {
	const sql = params.get("sql");
	return {
		filters: {
			months: parseMonths(params.get("from"), params.get("to")),
			mag: parsePair(params.get("mag"), DOMAIN.mag),
			depth: parsePair(params.get("depth"), DOMAIN.depth),
			box: parseBox(params.get("box")),
			regions: tidyRegions(params.getAll("region")),
		},
		sort: parseSort(params.get("sort")),
		sql: sql && sql.length <= MAX_SHARED_SQL ? sql : null,
	};
}

/** The query string for a state, without the leading question mark. */
export function serializeState(state: BoardState): string {
	const { filters, sort, sql } = state;
	const params = new URLSearchParams();
	if (filters.months) {
		params.set("from", filters.months.from);
		params.set("to", filters.months.to);
	}
	if (filters.mag) params.set("mag", filters.mag.join(","));
	if (filters.depth) params.set("depth", filters.depth.join(","));
	if (filters.box) {
		const { west, south, east, north } = filters.box;
		params.set("box", [west, south, east, north].join(","));
	}
	for (const region of filters.regions) params.append("region", region);
	if (
		sort.column !== DEFAULT_SORT.column ||
		sort.descending !== DEFAULT_SORT.descending
	) {
		params.set("sort", `${sort.column}.${sort.descending ? "desc" : "asc"}`);
	}
	if (sql && sql.length <= MAX_SHARED_SQL) params.set("sql", sql);
	// Commas are legal in a query string, and links read better with them.
	return params.toString().replaceAll("%2C", ",");
}
