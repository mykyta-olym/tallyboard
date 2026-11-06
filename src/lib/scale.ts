// The handful of scale functions the charts need. Small enough to own, which
// keeps a chart library out of the bundle.

export type Scale = ((value: number) => number) & {
	invert: (position: number) => number;
};

export function linearScale(
	[d0, d1]: readonly [number, number],
	[r0, r1]: readonly [number, number],
): Scale {
	const slope = (r1 - r0) / (d1 - d0);
	const scale = (value: number) => r0 + (value - d0) * slope;
	scale.invert = (position: number) => d0 + (position - r0) / slope;
	return scale;
}

export function logScale(
	[d0, d1]: readonly [number, number],
	[r0, r1]: readonly [number, number],
): Scale {
	const inner = linearScale([Math.log10(d0), Math.log10(d1)], [r0, r1]);
	const scale = (value: number) => inner(Math.log10(value));
	scale.invert = (position: number) => 10 ** inner.invert(position);
	return scale;
}

/** Round tick values from zero up to at least `max`. */
export function niceTicks(max: number, count = 3): number[] {
	if (max <= 0) return [0, 1];
	const raw = max / count;
	const power = 10 ** Math.floor(Math.log10(raw));
	const fraction = raw / power;
	const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
	const ticks: number[] = [];
	for (let tick = 0; tick < max + step; tick += step) ticks.push(tick);
	return ticks;
}

/** Powers of ten that cover `max`, starting at one. */
export function powerTicks(max: number): number[] {
	const ticks = [1];
	while ((ticks.at(-1) ?? 1) < max) ticks.push((ticks.at(-1) ?? 1) * 10);
	return ticks;
}
