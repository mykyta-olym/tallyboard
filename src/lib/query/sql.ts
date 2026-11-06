// Small helpers that keep values out of SQL unless they are provably safe.
// Filters come from the URL, so everything is treated as hostile here.

/** Quotes a string as a SQL literal. */
export function literal(value: string): string {
	if (value.includes("\0")) throw new RangeError("NUL in SQL literal");
	return `'${value.replaceAll("'", "''")}'`;
}

/** Writes a number as SQL, refusing anything that is not a finite number. */
export function numeric(value: number): string {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new RangeError(`not a finite number: ${String(value)}`);
	}
	return String(value);
}
