#!/usr/bin/env node
// track-codegraph.mjs
// PreToolUse hook that auto-DISCOVERS which projects you use CodeGraph in, for the Token Savings
// Stream Deck plugin. CodeGraph records no savings or query counts anywhere — only its per-project
// index (.codegraph/codegraph.db). So instead of counting anything, this hook stamps each project's
// ROOT PATH (the directory that holds a .codegraph/ folder) into:
//
//   ~/.tokensaver/codegraph.json  ->  {
//     "projectPaths": [".../projA", ".../projB"],   // every CodeGraph project you've used
//     "updatedAt": ...
//   }
//
// The plugin then runs `codegraph status --json <path>` for each project and estimates savings from
// the live index size (files indexed × tokens/file). The hook stores NO savings number itself.
//
// Fires on real CodeGraph use — the MCP tools (codegraph_explore/search/callers/callees/impact/node)
// and the CLI (codegraph query/callers/callees/impact/affected). Paths are deduped case- and
// separator-insensitively (case-insensitive only on Windows).
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
	const tool = String(p.tool_name || "");
	const isMcpQuery = /^mcp__codegraph__codegraph_(explore|search|callers|callees|impact|node)$/.test(tool);

	const cmd = (p.tool_input && p.tool_input.command) || "";
	const isCliQuery =
		tool === "Bash" && /(^|[\\/\s])codegraph(?:\.exe|\.cmd)?\s+(query|callers|callees|impact|affected)\b/.test(cmd);

	if (isMcpQuery || isCliQuery) {
		// Where did the lookup happen? CodeGraph's MCP tools accept an optional projectPath; else the cwd.
		const start =
			(p.tool_input && typeof p.tool_input.projectPath === "string" && p.tool_input.projectPath) ||
			p.cwd ||
			process.cwd();

		// Walk up to the nearest directory that holds a .codegraph/ index (like git finds .git/).
		let dir = path.resolve(start);
		let root = "";
		for (;;) {
			if (fs.existsSync(path.join(dir, ".codegraph"))) {
				root = dir;
				break;
			}
			const parent = path.dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}

		if (root) {
			const out = path.join(os.homedir(), ".tokensaver");
			const file = path.join(out, "codegraph.json");
			fs.mkdirSync(out, { recursive: true });

			let data = {};
			try {
				data = JSON.parse(fs.readFileSync(file, "utf8")) || {};
			} catch {
				/* missing/invalid -> start fresh */
			}

			// Store clean forward-slash absolute paths; dedupe by a key that is case-insensitive only
			// on Windows (macOS/Linux filesystems can be case-sensitive).
			const store = (x) => path.resolve(x).replace(/\\/g, "/");
			const key = (x) => (process.platform === "win32" ? store(x).toLowerCase() : store(x));
			const seen = new Map();
			const add = (x) => {
				if (typeof x === "string" && x.trim()) seen.set(key(x), store(x));
			};
			if (Array.isArray(data.projectPaths)) data.projectPaths.forEach(add);
			add(root);

			data.projectPaths = [...seen.values()];
			data.updatedAt = new Date().toISOString();
			fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
		}
	}
} catch {
	/* never block a tool call */
}

process.exit(0);
