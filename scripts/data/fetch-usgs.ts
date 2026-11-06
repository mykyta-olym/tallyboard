// Downloads the raw catalog slice from the USGS FDSN event service, one calendar
// year per request. The service rejects any query over 20,000 events, and the
// busiest year in this slice is well below that.
//
//   node scripts/data/fetch-usgs.ts
//
// Output goes to data/raw/, which is not committed. Existing files are reused,
// so a partial run can be resumed. Pass --force to download everything again.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import {
	END_YEAR,
	MIN_MAGNITUDE,
	RAW_DIR,
	RETRIEVED_PATH,
	START_YEAR,
	USGS_ENDPOINT,
} from "./config.ts";

const PAUSE_MS = 1500;
const SERVICE_LIMIT = 20_000;

function yearUrl(year: number): string {
	const params = new URLSearchParams({
		format: "csv",
		eventtype: "earthquake",
		orderby: "time-asc",
		minmagnitude: String(MIN_MAGNITUDE),
		starttime: `${year}-01-01T00:00:00`,
		endtime: `${year + 1}-01-01T00:00:00`,
	});
	return `${USGS_ENDPOINT}?${params}`;
}

async function download(url: string): Promise<string> {
	for (let attempt = 1; ; attempt += 1) {
		const response = await fetch(url);
		if (response.ok) return response.text();
		if (attempt === 3) throw new Error(`${response.status} from ${url}`);
		await wait(PAUSE_MS * attempt * 4);
	}
}

mkdirSync(RAW_DIR, { recursive: true });
const force = process.argv.includes("--force");

for (let year = START_YEAR; year <= END_YEAR; year += 1) {
	const path = join(RAW_DIR, `${year}.csv`);
	if (existsSync(path) && !force) continue;
	const body = await download(yearUrl(year));
	const rows = body.split("\n").length - 2;
	if (rows >= SERVICE_LIMIT) throw new Error(`${year}: ${rows} rows hits the service limit`);
	writeFileSync(path, body);
	writeFileSync(RETRIEVED_PATH, `${new Date().toISOString().slice(0, 10)}\n`);
	console.log(`${year}: ${rows} rows`);
	await wait(PAUSE_MS);
}
