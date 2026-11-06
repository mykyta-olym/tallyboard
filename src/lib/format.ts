const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const count = (value: number) => whole.format(value);

/** 12,345 below ten thousand steps stay full; axes use `compact` instead. */
export function compact(value: number): string {
	if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
	if (value >= 10_000) return `${Math.round(value / 1000)}K`;
	return whole.format(value);
}

export const percent = (share: number) => `${(share * 100).toFixed(1)}%`;

/** 1.8e19 J reads better than a twenty digit number. */
export function joules(value: number): string {
	const [mantissa = "0", exponent = "0"] = value.toExponential(1).split("e");
	return `${mantissa}e${exponent.replace("+", "")} J`;
}

export function monthLabel(month: string): string {
	const names = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
	const [year = "", number = "1"] = month.split("-");
	return `${names[Number(number) - 1] ?? ""} ${year}`;
}

/** Longitude and latitude with hemisphere letters. */
export const longitude = (value: number) =>
	`${Math.abs(value)}${value < 0 ? "W" : "E"}`;
export const latitude = (value: number) =>
	`${Math.abs(value)}${value < 0 ? "S" : "N"}`;
