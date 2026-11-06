// The catalog slice. Everything the data scripts share lives here, so changing
// the slice is one edit followed by `pnpm data:all`.
export const USGS_ENDPOINT = "https://earthquake.usgs.gov/fdsnws/event/1/query";
export const START_YEAR = 1990;
export const END_YEAR = 2025;
export const MIN_MAGNITUDE = 4.5;
export const RAW_DIR = "data/raw";
export const RETRIEVED_PATH = "data/raw/RETRIEVED";
export const PARQUET_PATH = "static/data/quakes.parquet";
export const MANIFEST_PATH = "data/manifest.json";

// Only events whose preferred record comes from USGS itself. The USGS statement
// on public domain data covers "USGS-authored or produced" data, so that is what
// this repository redistributes. See data/SOURCE.md before widening this list.
export const NETWORKS = ["us", "official"];

// Rounding applied when the Parquet file is written. USGS location uncertainty
// is measured in kilometres, so three decimals of a degree (about 110 m) keeps
// everything the source can support. Some older rows carry float noise such as
// twelve decimals, which costs space and means nothing.
export const COORDINATE_DECIMALS = 3;
export const DEPTH_DECIMALS = 2;
export const MAGNITUDE_DECIMALS = 2;

// `place` is free text. These are the labels where the text after the last comma
// is not a usable region: abbreviations, and named events that carry no country.
export const REGION_OVERRIDES: Record<string, string> = {
	AK: "Alaska",
	Burma: "Myanmar",
	"Burma (Myanmar)": "Myanmar",
	CA: "California",
	"East Timor": "Timor Leste",
	MX: "Mexico",
	NV: "Nevada",
	OR: "Oregon",
	"Hubbard Glacier": "Alaska",
	"Kahramanmaras earthquake sequence": "Turkey",
	"Lake Almanor": "California",
	"New Ireland": "Papua New Guinea",
	"Ridgecrest Earthquake Sequence": "California",
	"Santa Cruz Islands": "Solomon Islands",
	"Southern Drake Passage": "Drake Passage",
	"Southern Tibetan Plateau": "China",
	"Sumatra - Andaman Islands": "Indonesia",
	"Tokachi-Oki": "Japan",
};
