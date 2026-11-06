// Starts DuckDB-WASM and owns its connections. Everything is served from this
// site: the engine, the worker, the Parquet reader and the data. Nothing here
// talks to a third party at runtime.
import {
	AsyncDuckDB,
	type AsyncDuckDBConnection,
	getPlatformFeatures,
	VoidLogger,
} from "@duckdb/duckdb-wasm";
import workerUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import wasmUrl from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import { literal } from "../query/sql.ts";
import { loadTableSql } from "../query/table.ts";
import { appendRows, type ResultSet, toResultSet } from "./cells.ts";
import type { Cell } from "../csv.ts";

export type Stage = "engine" | "data" | "reader" | "table";

export const STAGE_LABELS: Record<Stage, string> = {
	engine: "Downloading the DuckDB engine",
	data: "Downloading the earthquake data",
	reader: "Loading the Parquet reader",
	table: "Building the table",
};

export interface Progress {
	stage: Stage;
	/** Bytes so far and in total, when the stage has a size. */
	loaded?: number;
	total?: number;
}

export class EngineError extends Error {
	constructor(
		readonly stage: Stage,
		cause: unknown,
	) {
		const reason = cause instanceof Error ? cause.message : String(cause);
		super(`${STAGE_LABELS[stage]} failed: ${reason}`);
		this.name = "EngineError";
	}
}

/** The longest a visitor's query may run before it is cancelled. */
export const USER_QUERY_TIMEOUT_MS = 30_000;
/** Rows kept from a visitor's query, for display and export. */
export const USER_ROW_LIMIT = 50_000;

export interface UserResult extends ResultSet {
	truncated: boolean;
	elapsedMs: number;
}

export interface Engine {
	version: string;
	/** Runs a statement built by the query builder. */
	query(sql: string): Promise<ResultSet>;
	/** Runs a visitor's statement read-only. */
	runUser(sql: string): Promise<UserResult>;
	/** Cancels the visitor's running statement, if any. */
	cancelUser(): Promise<void>;
	terminate(): Promise<void>;
}

async function downloadParquet(
	url: string,
	report: (progress: Progress) => void,
): Promise<Uint8Array<ArrayBuffer>> {
	const response = await fetch(url);
	if (!response.ok || !response.body) {
		throw new Error(`HTTP ${response.status} for ${url}`);
	}
	const encoded = response.headers.has("content-encoding");
	const total = encoded
		? undefined
		: Number(response.headers.get("content-length")) || undefined;
	const chunks: Uint8Array[] = [];
	let loaded = 0;
	const reader = response.body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		loaded += value.length;
		report({ stage: "data", loaded, total });
	}
	const bytes = new Uint8Array(loaded);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return bytes;
}

/** Rejects when the worker script cannot be loaded, which DuckDB would not report. */
function workerFailure(worker: Worker): Promise<never> {
	return new Promise((_, reject) => {
		worker.addEventListener("error", (event) => {
			reject(new Error(event.message || "the worker script did not load"));
		});
	});
}

function wrapStage<T>(stage: Stage, work: Promise<T>): Promise<T> {
	return work.catch((cause: unknown) => {
		throw cause instanceof EngineError ? cause : new EngineError(stage, cause);
	});
}

export async function startEngine(options: {
	parquetUrl: string;
	extensionRepository: string;
	onProgress: (progress: Progress) => void;
}): Promise<Engine> {
	const { parquetUrl, extensionRepository, onProgress } = options;

	const features = await getPlatformFeatures();
	if (!features.wasmExceptions) {
		throw new EngineError(
			"engine",
			"this browser does not support WebAssembly exceptions",
		);
	}

	const worker = new Worker(workerUrl);
	const failed = workerFailure(worker);
	const db = new AsyncDuckDB(new VoidLogger(), worker);

	try {
		const engineReady = wrapStage(
			"engine",
			Promise.race([
				db.instantiate(wasmUrl, null, (step) => {
					onProgress({
						stage: "engine",
						loaded: step.bytesLoaded,
						total: step.bytesTotal || undefined,
					});
				}),
				failed,
			]),
		);
		const dataReady = wrapStage("data", downloadParquet(parquetUrl, onProgress));
		const [, parquet] = await Promise.all([engineReady, dataReady]);

		const board = await wrapStage(
			"reader",
			(async () => {
				onProgress({ stage: "reader" });
				await db.open({});
				const connection = await db.connect();
				await connection.query(
					`SET custom_extension_repository = ${literal(extensionRepository)}`,
				);
				await connection.query("LOAD parquet");
				return connection;
			})(),
		);

		await wrapStage(
			"table",
			(async () => {
				onProgress({ stage: "table" });
				await db.registerFileBuffer("quakes.parquet", parquet);
				await board.query(loadTableSql("quakes.parquet"));
				await db.dropFile("quakes.parquet");
				// From here on nothing can reach a file or the network, and neither
				// setting can be switched back.
				await board.query("SET memory_limit = '1GB'");
				await board.query("SET enable_external_access = false");
				await board.query("SET lock_configuration = true");
			})(),
		);

		const user = await db.connect();
		const version = await db.getVersion();
		return createEngine(db, board, user, version);
	} catch (error) {
		await db.terminate().catch(() => {});
		throw error;
	}
}

function createEngine(
	db: AsyncDuckDB,
	board: AsyncDuckDBConnection,
	user: AsyncDuckDBConnection,
	version: string,
): Engine {
	let cancelled = false;

	async function runUser(sql: string): Promise<UserResult> {
		const started = performance.now();
		cancelled = false;
		const timer = setTimeout(() => {
			void cancelUser();
		}, USER_QUERY_TIMEOUT_MS);
		await user.query("BEGIN TRANSACTION READ ONLY");
		try {
			// prepare() uses DuckDB's own parser to refuse a second statement. It
			// runs before send(), which would otherwise execute all of them.
			const statement = await user.prepare(sql);
			await statement.close();

			const reader = await user.send(sql, true);
			const rows: Cell[][] = [];
			let columns: string[] = [];
			let truncated = false;
			for await (const batch of reader) {
				const fields = batch.schema.fields;
				columns = fields.map((field) => field.name);
				appendRows(batch, fields, rows, USER_ROW_LIMIT);
				if (rows.length >= USER_ROW_LIMIT) {
					truncated = true;
					break;
				}
				if (cancelled) throw new Error("query was canceled");
			}
			if (!columns.length) columns = reader.schema?.fields.map((f) => f.name) ?? [];
			if (truncated) await user.cancelSent().catch(() => false);
			return { columns, rows, truncated, elapsedMs: performance.now() - started };
		} finally {
			clearTimeout(timer);
			await user.query("ROLLBACK").catch(() => {});
		}
	}

	async function cancelUser(): Promise<void> {
		cancelled = true;
		await user.cancelSent().catch(() => false);
	}

	return {
		version,
		query: async (sql) => toResultSet(await board.query(sql)),
		runUser,
		cancelUser,
		terminate: () => db.terminate(),
	};
}
