import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const run = promisify(exec);

export type RtkResult = {
	ok: boolean;
	saved: number; // approximate, expanded from the compact "10.3M" figure
	percent: number | null;
	commands: number | null;
	error?: string;
};

export type GfyResult = {
	ok: boolean;
	net: number; // grossEst - spent (what we headline)
	grossEst: number; // queries * perQuery (ESTIMATE)
	spent: number; // real, from cost.json (total_input + total_output)
	queries: number;
	runs: number; // real, number of graph builds/updates in cost.json
	perQuery: number;
	haveCost: boolean; // whether cost.json was found and read
};

const MULT: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

/** Expand a compact figure like "10.3M" / "1,234" into an absolute number. */
function expand(num: string, suffix: string): number {
	const base = parseFloat(num.replace(/,/g, ""));
	const m = suffix ? MULT[suffix.toUpperCase()] ?? 1 : 1;
	return Math.round(base * m);
}

/**
 * Read RTK's own cumulative ledger by parsing `rtk gain`.
 * RTK measures real savings (it sees both the raw and compressed output and diffs them),
 * so this number is empirically grounded — not an estimate.
 *
 * If your rtk build exposes a structured flag (check `rtk gain --help`), point `command`
 * at it and parse JSON instead; or read RTK's SQLite DB directly for the exact integer.
 */
export async function readRtk(command: string): Promise<RtkResult> {
	try {
		const { stdout } = await run(command, { timeout: 8000, windowsHide: true });
		const saved = stdout.match(/Tokens saved:\s*([\d.,]+)\s*([KMBT]?)/i);
		const pct = stdout.match(/Tokens saved:[^(\n]*\(\s*([\d.]+)\s*%\s*\)/i);
		const cmds = stdout.match(/Total commands:\s*([\d.,]+)\s*([KMBT]?)/i);
		if (!saved) {
			return { ok: false, saved: 0, percent: null, commands: null, error: "Could not find 'Tokens saved:' in output" };
		}
		return {
			ok: true,
			saved: expand(saved[1], saved[2] ?? ""),
			percent: pct ? parseFloat(pct[1]) : null,
			commands: cmds ? expand(cmds[1], cmds[2] ?? "") : null,
		};
	} catch (e) {
		return { ok: false, saved: 0, percent: null, commands: null, error: e instanceof Error ? e.message : String(e) };
	}
}

/**
 * Graphify's contribution. Two parts, with very different trust levels:
 *
 *  - SPENT (real): Graphify logs the LLM tokens it burned on semantic extraction in
 *    `graphify-out/cost.json` ({ total_input_tokens, total_output_tokens, runs:[...] }).
 *    This is a COST ledger — it is NOT savings.
 *
 *  - GROSS SAVINGS (estimate): Graphify never logs per-query savings or a query count, so
 *    the saved side is queries * perQuery, where perQuery defaults to the ~121.3k benchmark
 *    (~123k raw vs ~1.7k against the graph). `queries` comes from a stats file you maintain
 *    (`{ "queries": <n> }`, e.g. bumped from Graphify's PreToolUse hook) or a manual value.
 *
 * net = grossEst - spent. Negative until queries pay back the build, which is the honest picture.
 */
export async function readGraphify(opts: {
	perQuery: number;
	fallbackQueries: number;
	statsPath?: string;
	costPath?: string; // path to cost.json, or to the graphify-out folder containing it
}): Promise<GfyResult> {
	// --- query count (estimate input) ---
	let queries = Math.max(0, Math.floor(opts.fallbackQueries || 0));
	if (opts.statsPath) {
		try {
			const raw = await readFile(expandHome(opts.statsPath), "utf8");
			const j = JSON.parse(raw) as { queries?: unknown };
			if (typeof j.queries === "number" && Number.isFinite(j.queries)) {
				queries = Math.max(0, Math.floor(j.queries));
			}
		} catch {
			/* missing/invalid -> manual count */
		}
	}

	// --- real spend from cost.json ---
	let spent = 0;
	let runs = 0;
	let haveCost = false;
	if (opts.costPath) {
		try {
			let p = expandHome(opts.costPath);
			if (!/cost\.json$/i.test(p)) p = join(p, "cost.json"); // allow pointing at graphify-out/
			const j = JSON.parse(await readFile(p, "utf8")) as {
				total_input_tokens?: unknown;
				total_output_tokens?: unknown;
				runs?: Array<{ input_tokens?: unknown; output_tokens?: unknown }>;
			};
			let ti = Number(j.total_input_tokens);
			let to = Number(j.total_output_tokens);
			runs = Array.isArray(j.runs) ? j.runs.length : 0;
			// fall back to summing runs if the totals are missing
			if (!Number.isFinite(ti) || !Number.isFinite(to)) {
				ti = (j.runs ?? []).reduce((s, r) => s + (Number(r.input_tokens) || 0), 0);
				to = (j.runs ?? []).reduce((s, r) => s + (Number(r.output_tokens) || 0), 0);
			}
			spent = (Number.isFinite(ti) ? ti : 0) + (Number.isFinite(to) ? to : 0);
			haveCost = true;
		} catch {
			/* missing/invalid cost.json -> spent stays 0 */
		}
	}

	const pq = opts.perQuery > 0 ? opts.perQuery : 121_300;
	const grossEst = queries * pq;
	return { ok: true, net: grossEst - spent, grossEst, spent, queries, runs, perQuery: pq, haveCost };
}

/** Expand a leading ~ to the user's home directory (cross-platform). */
function expandHome(p: string): string {
	return p.replace(/^~(?=[/\\]|$)/, process.env.HOME ?? process.env.USERPROFILE ?? "~");
}

/** Compact a number for a tiny key, e.g. 10_300_000 -> "10.3M". */
export function formatCompact(n: number): string {
	if (!Number.isFinite(n)) return "—";
	const abs = Math.abs(n);
	if (abs >= 1e12) return trim(n / 1e12) + "T";
	if (abs >= 1e9) return trim(n / 1e9) + "B";
	if (abs >= 1e6) return trim(n / 1e6) + "M";
	if (abs >= 1e3) return trim(n / 1e3) + "K";
	return String(Math.round(n));
}

function trim(x: number): string {
	const s = x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2);
	return s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}
