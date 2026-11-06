import { TABLE } from "./build.ts";
import { literal } from "./sql.ts";

/**
 * Loads the Parquet file into the table every query reads. Parquet stores the
 * numbers as DECIMAL to stay small. They become DOUBLE here because that is what
 * people expect in ad hoc SQL, and it keeps the results plain numbers.
 */
export function loadTableSql(path: string): string {
	return `CREATE TABLE ${TABLE} AS
SELECT id, time,
  latitude::DOUBLE AS latitude,
  longitude::DOUBLE AS longitude,
  depth::DOUBLE AS depth,
  mag::DOUBLE AS mag,
  mag_type, place, region
FROM read_parquet(${literal(path)})`;
}
