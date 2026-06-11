#!/usr/bin/env node
// track-graphify.mjs
// PreToolUse(Bash) hook that auto-tracks Graphify graph queries for the Token Savings
// Stream Deck plugin. When a real `graphify query|explain|path` command is about to run, it
// increments the query counter the plugin reads and records this project's cost.json path so the
// plugin can show net savings with ZERO configuration.
//
//   ~/.tokensaver/graphify.json  ->  {
//     "queries": N,                              // global total across all projects
//     "daily": { "YYYY-MM-DD": N },              // same queries bucketed by local day (for "today")
//     "costPaths": [".../a/graphify-out/cost.json", ".../b/graphify-out/cost.json"],
//     "costPath": ".../last/graphify-out/cost.json",  // last project (kept for back-compat)
//     "updatedAt": ...
//   }
//
// The day buckets only start once this updated hook is installed.
//
// `costPaths` accumulates one entry per project so the plugin can sum the real build cost across
// ALL projects you query (true multi-project aggregation). Entries are deduped case- and
// separator-insensitively so the same project is never counted twice.
//
// Counts only query/explain/path — the graph *lookups* that replace reading raw files. Build
// commands (update/extract/add) are a cost, already logged in cost.json, so they are NOT counted.
//
// Cross-platform, fast, and non-blocking: any error -> exit 0, so it can NEVER block a tool call.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let p = {};
try {
	if (!process.stdin.isTTY) p = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
} catch {
	/* no/invalid stdin -> treat as no-op */
}

try {
	const cmd = (p.tool_input && p.tool_input.command) || "";
	// A real graph lookup: `graphify query|explain|path` anywhere in the command. Handles prefixes
	// like `timeout 90 graphify query "..."`, absolute paths on macOS (`/usr/local/bin/graphify`) and
	// Windows (`C:\tools\graphify.exe`), and a `.exe`/`.cmd` suffix.
	if (/(^|[\\/\s])graphify(?:\.exe|\.cmd)?\s+(query|explain|path)\b/.test(cmd)) {
		const dir = path.join(os.homedir(), ".tokensaver");
		const file = path.join(dir, "graphify.json");
		fs.mkdirSync(dir, { recursive: true });

		let data = {};
		try {
			data = JSON.parse(fs.readFileSync(file, "utf8")) || {};
		} catch {
			/* missing/invalid -> start fresh */
		}

		const n = Number.isFinite(data.queries) ? Math.max(0, Math.floor(data.queries)) : 0;
		data.queries = n + 1;

		// Per-day bucket so the plugin can show today's Graphify estimate. Keyed by LOCAL date
		// (YYYY-MM-DD) to match the plugin's reader; prune to the most recent ~70 days.
		const ymd = localYMD();
		data.daily = data.daily && typeof data.daily === "object" ? data.daily : {};
		data.daily[ymd] = (Number(data.daily[ymd]) || 0) + 1;
		data.daily = prune(data.daily, 70);

		// Accumulate this project's cost.json so the plugin can sum spend across ALL projects.
		// Store clean forward-slash absolute paths; dedupe by a key that is case-insensitive only on
		// Windows (macOS/Linux filesystems can be case-sensitive).
		const store = (x) => path.resolve(x).replace(/\\/g, "/");
		const key = (x) => (process.platform === "win32" ? store(x).toLowerCase() : store(x));
		const seen = new Map();
		const add = (x) => {
			if (typeof x === "string" && x.trim()) seen.set(key(x), store(x));
		};
		if (Array.isArray(data.costPaths)) data.costPaths.forEach(add);
		add(data.costPath); // migrate older single-path files into the set

		const cwd = p.cwd || process.cwd();
		const cost = path.join(cwd, "graphify-out", "cost.json");
		if (fs.existsSync(cost)) {
			add(cost);
			data.costPath = store(cost); // keep last project for back-compat
		}
		data.costPaths = [...seen.values()];

		data.updatedAt = new Date().toISOString();
		fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
	}
} catch {
	/* never block a tool call */
}

/** Local calendar date as YYYY-MM-DD (matches the plugin's reader and RTK's `daily[].date`). */
function localYMD(d = new Date()) {
	const pad = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Keep only the most recent `keep` day buckets so the map can't grow without bound. */
function prune(daily, keep) {
	const keys = Object.keys(daily).sort();
	if (keys.length <= keep) return daily;
	const out = {};
	for (const k of keys.slice(-keep)) out[k] = daily[k];
	return out;
}

process.exit(0);
