# tallyboard

Local-first analytical SQL notebook and earthquake telemetry dashboard running entirely in the browser with SvelteKit and DuckDB-WASM.

## Overview

`tallyboard` executes analytical SQL queries directly in the browser against Parquet datasets of USGS earthquake records—with zero backend servers. It pairs structured cross-filtering (time range, magnitude, depth, geographic bounding box, and ocean/tectonic region) with reactive SQL notebook cells and URL-serialized view state.

## Architecture

- **`src/lib/engine/`** — Client-side analytical engine:
  - `duckdb.ts`: Initializes the DuckDB-WASM worker, registers the static Parquet dataset, and executes parameterized or custom SQL queries returning typed Apache Arrow results.
  - `cells.ts`: Reactive dependency graph and execution scheduler for SQL notebook cells.
- **`src/lib/query/`** — SQL generation and result projection:
  - `build.ts` & `sql.ts`: Compiles interactive filter selections into safe, composable DuckDB SQL predicates and aggregations (histograms, depth-vs-magnitude distributions, regional rollups).
  - `table.ts`: Tabular result formatting and column metadata inspection.
- **`src/lib/sql/guard.ts`** — Read-only SQL sanitizer ensuring user-edited notebook queries cannot invoke mutating or file-system pragma statements.
- **`src/lib/filters.ts` & `url-state.ts`** — Bidirectional serialization between filter state, custom SQL overrides, and URL search parameters for shareable analytical views.
- **`scripts/data/`** — Data pipeline scripts (`fetch-usgs.ts`, `build-parquet.ts`, `build-snapshot.ts`, `build-land.ts`) that fetch raw USGS earthquake feeds, compress them into columnar `.parquet` files using `@duckdb/node-api`, and precompute TopoJSON land geometry paths.

## Tech Stack

- **Frontend**: Svelte 5, SvelteKit (`@sveltejs/adapter-static`), TypeScript 6, Vite 8
- **In-Browser OLAP Engine**: `@duckdb/duckdb-wasm`, Apache Arrow
- **Data Pipeline**: `@duckdb/node-api`, `topojson-client`, `world-atlas`
- **Testing & Linting**: Vitest, Playwright, Biome

## Getting Started

```sh
# Install dependencies
pnpm install

# Run unit tests
npx vitest run
```

## License

[MIT](LICENSE)
