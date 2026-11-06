// The filter model. Everything here is plain data, so the query builder and the
// URL code can be tested without a browser or a database.

export type Range = readonly [number, number];

/** Inclusive month range, both ends as YYYY-MM. */
export interface MonthRange {
	from: string;
	to: string;
}

/**
 * A longitude and latitude box in degrees. When `west` is greater than `east`
 * the box crosses the antimeridian, which the map allows because it is centred
 * on the Pacific.
 */
export interface Box {
	west: number;
	south: number;
	east: number;
	north: number;
}

export interface Filters {
	months: MonthRange | null;
	mag: Range | null;
	depth: Range | null;
	box: Box | null;
	regions: readonly string[];
}

/** One filter dimension. A chart leaves its own dimension out of its query. */
export type Dimension = keyof Filters;

export const DOMAIN = {
	firstMonth: "1990-01",
	lastMonth: "2025-12",
	mag: [4.5, 9.2],
	depth: [0, 705],
} as const;

export const MAX_REGIONS = 12;
export const MAX_REGION_LENGTH = 80;

export const NO_FILTERS: Filters = {
	months: null,
	mag: null,
	depth: null,
	box: null,
	regions: [],
};

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonth(value: string): boolean {
	return MONTH.test(value);
}

/** The first day of the month after `month`, as YYYY-MM-DD. */
export function monthEnd(month: string): string {
	const match = MONTH.exec(month);
	if (!match) throw new RangeError(`not a month: ${month}`);
	const year = Number(match[1]);
	const next = Number(match[2]) + 1;
	return next > 12
		? `${year + 1}-01-01`
		: `${match[1]}-${String(next).padStart(2, "0")}-01`;
}

/** The number of months since January 1990. */
export function monthIndex(month: string): number {
	const match = MONTH.exec(month);
	if (!match) throw new RangeError(`not a month: ${month}`);
	return (Number(match[1]) - 1990) * 12 + Number(match[2]) - 1;
}

export function monthFromIndex(index: number): string {
	const year = 1990 + Math.floor(index / 12);
	const month = ((index % 12) + 12) % 12;
	return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export const MONTH_COUNT = monthIndex(DOMAIN.lastMonth) + 1;

const clamp = (value: number, [low, high]: Range) =>
	Math.min(high, Math.max(low, value));

/** Orders a pair, clamps it to the domain, and drops it when it covers everything. */
export function tidyRange(
	low: number,
	high: number,
	domain: Range,
): Range | null {
	if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
	const a = clamp(Math.min(low, high), domain);
	const b = clamp(Math.max(low, high), domain);
	return a <= domain[0] && b >= domain[1] ? null : [a, b];
}

export function tidyMonths(from: string, to: string): MonthRange | null {
	if (!isMonth(from) || !isMonth(to)) return null;
	const [first, last] = from <= to ? [from, to] : [to, from];
	const start = first < DOMAIN.firstMonth ? DOMAIN.firstMonth : first;
	const end = last > DOMAIN.lastMonth ? DOMAIN.lastMonth : last;
	if (start > DOMAIN.lastMonth || end < DOMAIN.firstMonth) return null;
	if (start === DOMAIN.firstMonth && end === DOMAIN.lastMonth) return null;
	return { from: start, to: end };
}

export function tidyBox(box: Box): Box | null {
	const { west, south, east, north } = box;
	if (![west, south, east, north].every(Number.isFinite)) return null;
	const inLongitude = (value: number) => value >= -180 && value <= 180;
	if (!inLongitude(west) || !inLongitude(east)) return null;
	const low = Math.max(-90, Math.min(south, north));
	const high = Math.min(90, Math.max(south, north));
	if (low >= high || west === east) return null;
	return { west, south: low, east, north: high };
}

export function tidyRegions(regions: readonly string[]): string[] {
	const seen = new Set<string>();
	for (const region of regions) {
		const name = region.trim();
		if (name && name.length <= MAX_REGION_LENGTH) seen.add(name);
		if (seen.size === MAX_REGIONS) break;
	}
	return [...seen];
}

export function hasFilters(filters: Filters): boolean {
	return Boolean(
		filters.months ||
			filters.mag ||
			filters.depth ||
			filters.box ||
			filters.regions.length,
	);
}
