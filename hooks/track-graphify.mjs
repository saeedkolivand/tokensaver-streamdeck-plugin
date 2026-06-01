#!/usr/bin/env node
// track-graphify.mjs
// PreToolUse(Bash) hook that auto-tracks Graphify graph queries for the Token Savings
// Stream Deck plugin. When a real `graphify query|explain|path` command is about to run, it
// increments the query counter the plugin reads and stamps the project's cost.json path so the
// plugin can show net savings with ZERO configuration.
//
//   ~/.tokensaver/graphify.json  ->  { "queries": N, "costPath": ".../graphify-out/cost.json", "updatedAt": ... }
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
	// A real graph lookup: `graphify query|explain|path` anywhere in the command
	// (handles prefixes like `timeout 90 graphify query "..."` and full paths to the binary).
	if (/(^|[\\/\s])graphify\s+(query|explain|path)\b/.test(cmd)) {
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

		// Stamp this project's cost.json so the plugin needs no path configuration.
		const cwd = p.cwd || process.cwd();
		const cost = path.join(cwd, "graphify-out", "cost.json");
		if (fs.existsSync(cost)) data.costPath = cost;

		data.updatedAt = new Date().toISOString();
		fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
	}
} catch {
	/* never block a tool call */
}

process.exit(0);
