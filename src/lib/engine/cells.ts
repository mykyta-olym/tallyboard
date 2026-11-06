// Turns Arrow results into plain table cells. A visitor's query can return any
// DuckDB type, and several arrive in a form that would display wrongly if passed
// straight through: DECIMAL comes back unscaled, HUGEINT arrives as a decimal,
// and BIGINT is a JS bigint. The conversions were checked against the engine.
import { DataType, type Field, type Table } from "apache-arrow";
import type { Cell } from "../csv.ts";

export interface ResultSet {
	columns: string[];
	rows: Cell[][];
}

/** Writes an unscaled integer string with `scale` digits after the point. */
export function applyScale(digits: string, scale: number): string {
	if (scale <= 0) return digits;
	const negative = digits.startsWith("-");
	const body = (negative ? digits.slice(1) : digits).padStart(scale + 1, "0");
	const whole = body.slice(0, -scale);
	const fraction = body.slice(-scale).replace(/0+$/, "");
	return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** Keeps a number exact: only values a double can hold become numbers. */
function exactNumber(text: string): number | string {
	const value = Number(text);
	return Number.isSafeInteger(value) || (text.includes(".") && text.length <= 16)
		? value
		: text;
}

const pad = (value: number, size = 2) => String(value).padStart(size, "0");

export function formatTimestamp(ms: number): string {
	return new Date(ms).toISOString().replace("T", " ").replace(/\.000Z$|Z$/, "");
}

export function formatDate(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

function formatTime(value: number | bigint, unitsPerSecond: number): string {
	const total = Number(value) / unitsPerSecond;
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	return `${pad(hours)}:${pad(minutes)}:${pad(Math.floor(total % 60))}`;
}

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => pad(byte.toString(16))).join("");
}

function nested(value: unknown): string {
	return JSON.stringify(value, (_, item) =>
		typeof item === "bigint" ? exactNumber(item.toString()) : item,
	);
}

export function toCell(value: unknown, type: DataType): Cell {
	if (value === null || value === undefined) return null;
	if (DataType.isDecimal(type)) {
		return exactNumber(applyScale(String(value), type.scale));
	}
	if (DataType.isTimestamp(type)) return formatTimestamp(Number(value));
	if (DataType.isDate(type)) return formatDate(Number(value));
	if (DataType.isTime(type)) {
		const unit = 1000 ** (type.unit as number);
		return formatTime(value as number | bigint, unit);
	}
	if (DataType.isBinary(type) || DataType.isFixedSizeBinary(type)) {
		return toHex(value as Uint8Array);
	}
	if (DataType.isInterval(type)) return "(interval, cast to VARCHAR to read)";
	if (
		DataType.isList(type) ||
		DataType.isStruct(type) ||
		DataType.isMap(type) ||
		DataType.isFixedSizeList(type)
	) {
		return nested(value);
	}
	if (typeof value === "bigint") return exactNumber(value.toString());
	if (typeof value === "number" || typeof value === "boolean") return value;
	return String(value);
}

export function appendRows(
	table: Pick<Table, "numRows" | "numCols" | "getChildAt">,
	fields: readonly Field[],
	rows: Cell[][],
	limit = Number.POSITIVE_INFINITY,
): void {
	const vectors = fields.map((_, index) => table.getChildAt(index));
	const end = Math.min(table.numRows, limit - rows.length);
	for (let row = 0; row < end; row += 1) {
		rows.push(
			fields.map((field, index) =>
				toCell(vectors[index]?.get(row) ?? null, field.type),
			),
		);
	}
}

export function toResultSet(table: Table): ResultSet {
	const fields = table.schema.fields;
	const rows: Cell[][] = [];
	appendRows(table, fields, rows);
	return { columns: fields.map((field) => field.name), rows };
}

/** Rows as objects keyed by column, for the board's own queries. */
export function toObjects<T>(result: ResultSet): T[] {
	return result.rows.map(
		(row) =>
			Object.fromEntries(
				result.columns.map((column, index) => [column, row[index]]),
			) as T,
	);
}
