// CSV writing, RFC 4180 style, with a guard for spreadsheet formulas.

export type Cell = string | number | boolean | null;

/**
 * A text cell starting with one of these runs as a formula when the file is
 * opened in a spreadsheet. A shared link can put any text into a result, so such
 * cells get a leading apostrophe. Numbers are never changed.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value: Cell): string {
	if (value === null) return "";
	if (typeof value !== "string") return String(value);
	const text = FORMULA_START.test(value) ? `'${value}` : value;
	return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(
	columns: readonly string[],
	rows: readonly (readonly Cell[])[],
): string {
	const lines = [columns.map(csvCell).join(",")];
	for (const row of rows) lines.push(row.map(csvCell).join(","));
	return `${lines.join("\r\n")}\r\n`;
}
