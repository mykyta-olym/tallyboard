// First check on a visitor's query. This exists to give a clear message. It is
// not what keeps the data safe: the engine layer also refuses multiple statements
// through prepare(), runs inside a READ ONLY transaction, and has file and network
// access switched off with the configuration locked.

export type GuardResult =
	| { ok: true; sql: string }
	| { ok: false; message: string };

const READ_STATEMENTS = new Set([
	"SELECT",
	"WITH",
	"FROM",
	"VALUES",
	"TABLE",
	"DESCRIBE",
	"DESC",
	"SHOW",
	"SUMMARIZE",
	"EXPLAIN",
	"PIVOT",
	"UNPIVOT",
]);

/** Words that start a write when they appear outside brackets, as in WITH or EXPLAIN. */
const WRITE_KEYWORDS = new Set(["INSERT", "UPDATE", "DELETE", "MERGE"]);

interface Scan {
	/** Every word outside strings, comments and quoted names, with bracket depth. */
	words: { text: string; depth: number }[];
	/** Offset of the first semicolon that ends a statement, or -1. */
	semicolon: number;
	/** Whether anything other than space or comments follows that semicolon. */
	trailing: boolean;
}

function skipDollarQuote(sql: string, start: number): number | null {
	const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(start));
	if (!match) return null;
	const end = sql.indexOf(match[0], start + match[0].length);
	return end === -1 ? sql.length : end + match[0].length;
}

function skipQuoted(
	sql: string,
	start: number,
	quote: string,
	backslash = false,
): number {
	let index = start + 1;
	while (index < sql.length) {
		const char = sql[index];
		if (backslash && char === "\\") {
			index += 2;
		} else if (char === quote) {
			if (sql[index + 1] !== quote) return index + 1;
			index += 2;
		} else {
			index += 1;
		}
	}
	return sql.length;
}

function skipBlockComment(sql: string, start: number): number {
	let depth = 1;
	let index = start + 2;
	while (index < sql.length && depth > 0) {
		if (sql.startsWith("/*", index)) {
			depth += 1;
			index += 2;
		} else if (sql.startsWith("*/", index)) {
			depth -= 1;
			index += 2;
		} else {
			index += 1;
		}
	}
	return index;
}

function scan(sql: string): Scan {
	const out: Scan = { words: [], semicolon: -1, trailing: false };
	let index = 0;
	let depth = 0;
	while (index < sql.length) {
		const char = sql[index] ?? "";
		if (sql.startsWith("--", index)) {
			const newline = sql.indexOf("\n", index);
			index = newline === -1 ? sql.length : newline + 1;
		} else if (sql.startsWith("/*", index)) {
			index = skipBlockComment(sql, index);
		} else if (char === "'" || char === '"') {
			index = skipQuoted(sql, index, char);
		} else if (char === "$") {
			index = skipDollarQuote(sql, index) ?? index + 1;
		} else if (/\s/.test(char)) {
			index += 1;
		} else if (char === ";") {
			if (out.semicolon === -1) out.semicolon = index;
			index += 1;
		} else {
			if (out.semicolon !== -1) out.trailing = true;
			if (/[A-Za-z_]/.test(char)) {
				const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(index))?.[0] ?? "";
				const next = index + word.length;
				if (/^[eE]$/.test(word) && sql[next] === "'") {
					index = skipQuoted(sql, next, "'", true);
				} else {
					out.words.push({ text: word.toUpperCase(), depth });
					index = next;
				}
			} else {
				if (char === "(") depth += 1;
				if (char === ")") depth = Math.max(0, depth - 1);
				index += 1;
			}
		}
	}
	return out;
}

const readOnly = (word: string) =>
	`${word} is not allowed. This console is read-only, so it runs SELECT, WITH, DESCRIBE, SHOW, SUMMARIZE and EXPLAIN.`;

export function checkReadOnly(input: string): GuardResult {
	const { words, semicolon, trailing } = scan(input);
	const first = words[0]?.text;
	if (!first) return { ok: false, message: "Write a query first." };
	if (trailing) {
		return {
			ok: false,
			message: "Run one statement at a time. Remove everything after the first semicolon.",
		};
	}
	if (!READ_STATEMENTS.has(first)) return { ok: false, message: readOnly(first) };
	const write = words.find(
		(word) => word.depth === 0 && WRITE_KEYWORDS.has(word.text),
	);
	if (write) return { ok: false, message: readOnly(write.text) };
	const end = semicolon === -1 ? input.length : semicolon;
	return { ok: true, sql: input.slice(0, end).trim() };
}

export interface ExplainedError {
	title: string;
	detail: string;
	hint: string | null;
}

/** Turns a DuckDB error into a heading, the original text and a next step. */
export function explainError(raw: string): ExplainedError {
	const detail = raw.replace(/^Error:\s*/, "").trim();
	const kind = /^([A-Za-z ]+?) Error:/.exec(detail)?.[1] ?? "";
	const rules: [RegExp, string, string | null][] = [
		[
			/transaction is launched in read-only mode/,
			"This query tries to change data",
			"The console is read-only. The data cannot be changed from here.",
		],
		[
			/Cannot prepare multiple statements/,
			"Run one statement at a time",
			"Remove everything after the first semicolon.",
		],
		[
			/file system operations are disabled|Permission Error/,
			"Files and network access are off",
			"Queries can only read the quakes table.",
		],
		[
			/query was canceled|Interrupted/,
			"Query cancelled",
			"Add a LIMIT or an aggregate if it runs for too long.",
		],
		[
			/Table with name .* does not exist/,
			"That table does not exist",
			"The only table here is quakes. Try DESCRIBE quakes.",
		],
		[
			/Referenced column .* not found|does not have a column named/,
			"That column does not exist",
			"Try DESCRIBE quakes for the column names.",
		],
		[
			/Out of Memory/,
			"The query ran out of memory",
			"A browser tab has limited memory. Filter or aggregate first.",
		],
	];
	for (const [pattern, title, hint] of rules) {
		if (pattern.test(detail)) return { title, detail, hint };
	}
	if (kind === "Parser") {
		return {
			title: "Syntax error",
			detail,
			hint: "Check the query near the marked position.",
		};
	}
	return { title: kind ? `${kind} error` : "Query failed", detail, hint: null };
}
