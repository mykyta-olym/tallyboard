// The shape of one refresh of the board, shared by the live engine and the
// snapshot baked in at build time.

export interface Summary {
	events: number;
	first_day: string | null;
	last_day: string | null;
	largest_mag: number | null;
	largest_place: string | null;
	largest_day: string | null;
	largest_id: string | null;
	median_depth: number | null;
	energy_joules: number | null;
	top_ten_energy: number | null;
	fixed_depth_share: number | null;
}

export interface Fit {
	mc: number;
	n: number;
	b: number | null;
}

export interface MonthBin {
	month: string;
	events: number;
}

export interface MagBin {
	mag: number;
	events: number;
	at_least: number;
}

export interface DepthBin {
	depth: number;
	events: number;
}

export interface MapCell {
	lat: number;
	lon: number;
	events: number;
}

export interface RegionBin {
	region: string;
	events: number;
}

export interface EventRow {
	time: string;
	mag: number;
	mag_type: string;
	depth: number;
	region: string;
	place: string;
	latitude: number;
	longitude: number;
	id: string;
}

export interface BoardData {
	summary: Summary;
	fit: Fit | null;
	timeline: MonthBin[];
	magnitude: MagBin[];
	depth: DepthBin[];
	map: MapCell[];
	regions: RegionBin[];
	events: EventRow[];
}

export interface Snapshot {
	/** SHA-256 of the Parquet file the numbers came from. */
	parquetSha256: string;
	totalEvents: number;
	regionNames: string[];
	board: BoardData;
}
