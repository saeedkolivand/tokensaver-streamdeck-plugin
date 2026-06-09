/**
 * Regenerates docs/preview.png from the *real* key faces in src/render.ts, so the README banner
 * always matches what the device shows. Run with: `npm run preview`.
 *
 * Each readout is rendered by renderKey() (an SVG data URI); we decode it, inline it into a wider
 * banner SVG laid out as a row of keys, then rasterize to PNG with @resvg/resvg-js.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

import { renderKey } from "../src/render";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "docs", "preview.png");

// Representative sample values — a marketing banner, not live data. Colors mirror token-savings.ts.
const FACES = [
	{ tag: "RTK", value: "24.2M", sub: "92% saved", color: "#34d399" },
	{ tag: "GRAPHIFY", value: "≈2.8M", sub: "net est · 25q", color: "#fbbf24" },
	{ tag: "CODEGRAPH", value: "≈3.0M", sub: "1K files · 2p", color: "#a3e635" },
	{ tag: "TOTAL", value: "≈30M", sub: "measured+est", color: "#60a5fa" },
	{ tag: "TODAY", value: "315K", sub: "saved today", color: "#a78bfa" },
	{ tag: "WEEK", value: "9.4M", sub: "this week", color: "#f472b6" },
	{ tag: "MONTH", value: "23.9M", sub: "this month", color: "#38bdf8" },
	{ tag: "MONEY", value: "≈$81", sub: "today $0.9", color: "#facc15" },
];

const KEY = 144;
const GAP = 24;
const PAD = 36;
const W = PAD * 2 + FACES.length * KEY + (FACES.length - 1) * GAP;
const H = PAD * 2 + KEY;

/** Decode renderKey's data URI back to the inner SVG body, wrapped in a positioning group. */
function placed(face: (typeof FACES)[number], x: number): string {
	const svg = Buffer.from(renderKey(face).split(",")[1], "base64").toString("utf8");
	const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
	return `<g transform="translate(${x}, ${PAD})">${inner}</g>`;
}

const keys = FACES.map((f, i) => placed(f, PAD + i * (KEY + GAP))).join("\n");
const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect x="0" y="0" width="${W}" height="${H}" rx="28" fill="#06080f"/>
${keys}
</svg>`;

const png = new Resvg(banner, { fitTo: { mode: "zoom", value: 2 }, font: { loadSystemFonts: true } })
	.render()
	.asPng();

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`Wrote ${out} (${W * 2}×${H * 2}px, ${(png.length / 1024).toFixed(0)} KB)`);
