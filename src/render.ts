/**
 * Renders the key face as an SVG data URI. The Stream Deck SDK accepts SVG via setImage,
 * which looks far better than a plain text title and lets us colour-code each mode.
 */

const SHELL = `<rect x="0" y="0" width="144" height="144" rx="22" fill="#0b1020"/>
<rect x="1" y="1" width="142" height="142" rx="21" fill="none" stroke="#1e2a44" stroke-width="2"/>`;

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

/** Shrink the big number to fit the key as it grows in length. */
function fitSize(value: string): number {
	const n = value.length;
	if (n <= 4) return 46;
	if (n === 5) return 40;
	if (n === 6) return 34;
	if (n === 7) return 30;
	return 25;
}

function esc(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderKey(opts: { tag: string; value: string; sub: string; color: string }): string {
	const size = fitSize(opts.value);
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
${SHELL}
<rect x="22" y="22" width="100" height="4" rx="2" fill="${opts.color}"/>
<text x="72" y="45" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="700" letter-spacing="2" fill="${opts.color}">${esc(opts.tag)}</text>
<text x="72" y="92" text-anchor="middle" font-family="${FONT}" font-size="${size}" font-weight="800" fill="#f8fafc">${esc(opts.value)}</text>
<text x="72" y="120" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="500" fill="#94a3b8">${esc(opts.sub)}</text>
</svg>`;
	return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}
