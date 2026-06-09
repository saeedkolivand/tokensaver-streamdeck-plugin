import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const run = promisify(exec);

export type RtkResult = {
	ok: boolean;
	totalSaved: number; // cumulative measured saved tokens (summary.total_saved)
	today: number; // measured saved tokens for the current local day
	week: number; // measured saved tokens for the week containing today
	month: number; // measured saved tokens for the current local month
	avgPct: number | null; // summary.avg_savings_pct
	error?: string;
};

export type GfyResult = {
	ok: boolean;
	net: number; // grossEst - spent (what we headline)
	grossEst: number; // queries * perQuery (ESTIMATE)
	spent: number; // real, summed across every project's cost.json (total_input + total_output)
	queries: number;
	runs: number; // real, number of graph builds/updates summed across all cost.json
	perQuery: number;
	haveCost: boolean; // whether at least one cost.json was found and read
	projects: number; // number of distinct project cost.json files summed
};

export type CgResult = {
	ok: boolean;
	saved: number; // filesIndexed * perFile (ESTIMATE) — capacity, not realized; always ≈
	files: number; // total indexed files summed across projects (measured via `codegraph status`)
	nodes: number; // total indexed symbols summed across projects (measured)
	projects: number; // number of initialized CodeGraph projects summed
	perFile: number;
};

/**
 * Read RTK's measured ledger via `rtk gain --all --format json`.
 * RTK sees both the raw and compressed command output and diffs them, so these are real measured
 * savings — not estimates. The JSON gives a cumulative summary plus per-day / -week / -month
 * breakdowns, which feed the Today / Week / Month readouts.
 *
 * `base` defaults to "rtk gain"; we append `--all --format json` unless the user already specified a
 * `--format` (e.g. they pointed this at a full binary path with their own flags).
 */
export async function readRtk(base: string): Promise<RtkResult> {
	const empty = (error?: string): RtkResult => ({
		ok: false,
		totalSaved: 0,
		today: 0,
		week: 0,
		month: 0,
		avgPct: null,
		error,
	});
	try {
		const cmd = /--format\b/.test(base) ? base : `${base} --all --format json`;
		const { stdout } = await run(cmd, { timeout: 8000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
		const j = JSON.parse(stdout) as {
			summary?: { total_saved?: unknown; avg_savings_pct?: unknown };
			daily?: Array<{ date?: string; saved_tokens?: unknown }>;
			weekly?: Array<{ week_start?: string; week_end?: string; saved_tokens?: unknown }>;
			monthly?: Array<{ month?: string; saved_tokens?: unknown }>;
		};

		const ymd = localYMD();
		const ym = localYM();
		const daily = j.daily ?? [];
		const weekly = j.weekly ?? [];
		const monthly = j.monthly ?? [];

		const today = numOf(daily.find((d) => d.date === ymd)?.saved_tokens);
		const wk =
			weekly.find((w) => (w.week_start ?? "") <= ymd && ymd <= (w.week_end ?? "")) ?? weekly[weekly.length - 1];
		const month = monthly.find((m) => m.month === ym);

		return {
			ok: true,
			totalSaved: numOf(j.summary?.total_saved),
			today,
			week: numOf(wk?.saved_tokens),
			month: numOf(month?.saved_tokens),
			avgPct: Number.isFinite(Number(j.summary?.avg_savings_pct))
				? Math.round(Number(j.summary?.avg_savings_pct))
				: null,
		};
	} catch (e) {
		return empty(e instanceof Error ? e.message : String(e));
	}
}

/**
 * Graphify's contribution. Two parts, with very different trust levels:
 *
 *  - SPENT (real): Graphify logs the LLM tokens it burned on semantic extraction in
 *    `graphify-out/cost.json` ({ total_input_tokens, total_output_tokens, runs:[...] }).
 *    This is a COST ledger — it is NOT savings.
 *
 *  - GROSS SAVINGS (estimate): Graphify never logs per-query savings or a query count, so the
 *    saved side is queries * perQuery, where perQuery defaults to the ~121.3k benchmark
 *    (~123k raw vs ~1.7k against the graph). `queries` comes from the stats file the
 *    `track-graphify` hook maintains (`{ "queries": N, "costPath": "..." }`) or a manual value.
 *
 * The stats file also carries `costPaths` (one cost.json per project, stamped by the hook), so when
 * no explicit cost path is configured the plugin finds and **sums** every project's real spend
 * automatically — true multi-project aggregation. (`costPath`, the single last-project field from
 * older files, is still honored as a fallback.)
 *
 * net = grossEst - spent. Negative until queries pay back the build, which is the honest picture.
 */
export async function readGraphify(opts: {
	perQuery: number;
	fallbackQueries: number;
	statsPath?: string;
	costPath?: string; // explicit path to cost.json (or the graphify-out folder); overrides the stamped ones
}): Promise<GfyResult> {
	// --- stats file: query count (+ the per-project cost paths the hook recorded) ---
	let queries = Math.max(0, Math.floor(opts.fallbackQueries || 0));
	let statsCostPaths: string[] = [];
	if (opts.statsPath) {
		try {
			const raw = await readFile(expandHome(opts.statsPath), "utf8");
			const j = JSON.parse(raw) as { queries?: unknown; costPath?: unknown; costPaths?: unknown };
			if (typeof j.queries === "number" && Number.isFinite(j.queries)) {
				queries = Math.max(0, Math.floor(j.queries));
			}
			if (Array.isArray(j.costPaths)) {
				statsCostPaths = j.costPaths.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
			}
			if (statsCostPaths.length === 0 && typeof j.costPath === "string" && j.costPath.trim()) {
				statsCostPaths = [j.costPath.trim()]; // older single-path files
			}
		} catch {
			/* missing/invalid -> manual count */
		}
	}

	// --- real spend: explicit override wins; otherwise sum every project's cost.json ---
	const costList = (opts.costPath ?? "").trim() ? [opts.costPath!.trim()] : statsCostPaths;
	let spent = 0;
	let runs = 0;
	let projects = 0;
	const seen = new Set<string>();
	const winFs = process.platform === "win32"; // case-insensitive paths only on Windows
	for (const raw of costList) {
		let p = expandHome(raw);
		if (!/cost\.json$/i.test(p)) p = join(p, "cost.json"); // allow pointing at graphify-out/
		const norm = p.replace(/\\/g, "/");
		const k = winFs ? norm.toLowerCase() : norm;
		if (seen.has(k)) continue; // never double-count a project
		seen.add(k);
		const c = await readCostFile(p);
		if (c.ok) {
			spent += c.spent;
			runs += c.runs;
			projects += 1;
		}
	}

	const pq = opts.perQuery > 0 ? opts.perQuery : 121_300;
	const grossEst = queries * pq;
	return { ok: true, net: grossEst - spent, grossEst, spent, queries, runs, perQuery: pq, haveCost: projects > 0, projects };
}

/**
 * CodeGraph's contribution — an INDEX-SIZE estimate read straight from CodeGraph's own data.
 *
 * CodeGraph stores no savings or query count anywhere (its `.codegraph/` holds only the graph index),
 * so there's no realized-savings ledger to read like Graphify's cost.json. What it *does* expose is the
 * live index size via `codegraph status --json <project>` (fileCount / nodeCount). We turn that into a
 * savings estimate: `filesIndexed × perFile` — the tokens an agent would spend reading the codebase raw,
 * which CodeGraph lets it skip. It's a CAPACITY estimate (≈ repo size), so it's always marked `≈`.
 *
 * The projects to read come from the `track-codegraph` hook, which stamps each project's path into the
 * stats file (`{ "projectPaths": [...] }`) as you use CodeGraph — true zero-config multi-project. A
 * manual `projects` override (comma/newline-separated paths) wins when set.
 */
export async function readCodegraph(opts: {
	perFile: number;
	command: string; // base CodeGraph invocation, default "codegraph"; we append `status --json <path>`
	statsPath?: string;
	projects?: string; // manual override: comma/newline-separated project paths
}): Promise<CgResult> {
	// --- project list: explicit override wins; otherwise the hook-stamped paths ---
	let paths: string[] = [];
	if (opts.projects && opts.projects.trim()) {
		paths = opts.projects
			.split(/[,\n]/)
			.map((s) => s.trim())
			.filter(Boolean);
	} else if (opts.statsPath) {
		try {
			const j = JSON.parse(await readFile(expandHome(opts.statsPath), "utf8")) as { projectPaths?: unknown };
			if (Array.isArray(j.projectPaths)) {
				paths = j.projectPaths.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
			}
		} catch {
			/* missing/invalid -> no projects */
		}
	}

	const base = (opts.command || "").trim() || "codegraph";
	const perFile = opts.perFile > 0 ? opts.perFile : 3000;
	let files = 0;
	let nodes = 0;
	let projects = 0;
	const seen = new Set<string>();
	const winFs = process.platform === "win32"; // case-insensitive paths only on Windows
	for (const raw of paths) {
		const p = expandHome(raw);
		const key = winFs ? p.replace(/\\/g, "/").toLowerCase() : p;
		if (seen.has(key)) continue; // never double-count a project
		seen.add(key);
		const s = await readCgStatus(base, p);
		if (s.ok) {
			files += s.files;
			nodes += s.nodes;
			projects += 1;
		}
	}
	return { ok: true, saved: files * perFile, files, nodes, projects, perFile };
}

/** Run `codegraph status --json <path>` and pull the measured index size for one project. */
async function readCgStatus(base: string, path: string): Promise<{ ok: boolean; files: number; nodes: number }> {
	try {
		const { stdout } = await run(`${base} status --json "${path}"`, {
			timeout: 8000,
			windowsHide: true,
			maxBuffer: 4 * 1024 * 1024,
		});
		const j = JSON.parse(stdout) as { initialized?: unknown; fileCount?: unknown; nodeCount?: unknown };
		if (j.initialized !== true) return { ok: false, files: 0, nodes: 0 };
		return { ok: true, files: numOf(j.fileCount), nodes: numOf(j.nodeCount) };
	} catch {
		return { ok: false, files: 0, nodes: 0 }; // not on PATH / not initialized / bad json -> skip
	}
}

/** Read one Graphify cost.json and return its spend + build-run count. */
async function readCostFile(p: string): Promise<{ ok: boolean; spent: number; runs: number }> {
	try {
		const j = JSON.parse(await readFile(p, "utf8")) as {
			total_input_tokens?: unknown;
			total_output_tokens?: unknown;
			runs?: Array<{ input_tokens?: unknown; output_tokens?: unknown }>;
		};
		let ti = Number(j.total_input_tokens);
		let to = Number(j.total_output_tokens);
		const runs = Array.isArray(j.runs) ? j.runs.length : 0;
		// fall back to summing runs if the totals are missing
		if (!Number.isFinite(ti) || !Number.isFinite(to)) {
			ti = (j.runs ?? []).reduce((s, r) => s + (Number(r.input_tokens) || 0), 0);
			to = (j.runs ?? []).reduce((s, r) => s + (Number(r.output_tokens) || 0), 0);
		}
		const spent = (Number.isFinite(ti) ? ti : 0) + (Number.isFinite(to) ? to : 0);
		return { ok: true, spent, runs };
	} catch {
		return { ok: false, spent: 0, runs: 0 }; // missing/invalid cost.json -> skipped
	}
}

/** Coerce an unknown (often from JSON) to a finite number, else 0. */
function numOf(v: unknown): number {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
}

/** Local calendar date as YYYY-MM-DD (matches RTK's `daily[].date`). */
function localYMD(d = new Date()): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local month as YYYY-MM (matches RTK's `monthly[].month`). */
function localYM(d = new Date()): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function pad(n: number): string {
	return String(n).padStart(2, "0");
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

/** Format a USD amount for a tiny key, e.g. 72 -> "$72", 1234 -> "$1.2K", 0.42 -> "$0.42". */
export function formatMoney(usd: number): string {
	if (!Number.isFinite(usd)) return "—";
	const neg = usd < 0 ? "−" : "";
	const abs = Math.abs(usd);
	if (abs >= 1e3) return neg + "$" + formatCompact(abs);
	if (abs >= 100) return neg + "$" + Math.round(abs);
	if (abs >= 1) return neg + "$" + abs.toFixed(1).replace(/\.0$/, "");
	return neg + "$" + abs.toFixed(2);
}

function trim(x: number): string {
	const s = x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2);
	return s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}
