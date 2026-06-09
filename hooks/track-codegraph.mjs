#!/usr/bin/env node
// track-codegraph.mjs
// PreToolUse hook that auto-tracks CodeGraph graph lookups for the Token Savings Stream Deck plugin,
// so the CodeGraph readout grows with every use. CodeGraph is used two ways, and this hook counts BOTH:
//
//   1. MCP server (the primary path): the agent calls mcp__codegraph__codegraph_explore /
//      _search / _callers / _callees / _impact / _node.
//   2. CLI (secondary): `codegraph query|callers|callees|impact|affected`.
//
// On every real lookup it increments the query counter the plugin reads:
//
//   ~/.tokensaver/codegraph.json  ->  { "queries": N, "updatedAt": ... }
//
// CodeGraph builds its index 100% locally (no LLM/API cost) and records no savings of its own, so the
// plugin's CodeGraph readout is a pure realized estimate: queries × tokens/query.
//
// Build/metadata commands (init/index/sync/status/files/serve/install, and the MCP
// codegraph_status / codegraph_files tools) are NOT counted — they aren't file-replacing lookups.
//
// Register it (global ~/.claude/settings.json) with a matcher that covers both Bash and the MCP
// tools, e.g. "matcher": "Bash|mcp__codegraph__.*". Cross-platform, fast, and non-blocking: any
// error -> exit 0, so it can NEVER block a tool call.

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
	// The heavy CodeGraph lookups that replace reading raw files. Status/files are metadata, not
	// savings, so they're excluded from both the MCP and CLI patterns below.
	const isMcpQuery = /^mcp__codegraph__codegraph_(explore|search|callers|callees|impact|node)$/.test(tool);

	// CLI: `codegraph query|callers|callees|impact|affected` anywhere in the command. Handles prefixes
	// like `timeout 90 codegraph query "..."`, absolute paths on macOS (`/usr/local/bin/codegraph`) and
	// Windows (`C:\tools\codegraph.exe`), and a `.exe`/`.cmd` suffix.
	const cmd = (p.tool_input && p.tool_input.command) || "";
	const isCliQuery =
		tool === "Bash" && /(^|[\\/\s])codegraph(?:\.exe|\.cmd)?\s+(query|callers|callees|impact|affected)\b/.test(cmd);

	if (isMcpQuery || isCliQuery) {
		const dir = path.join(os.homedir(), ".tokensaver");
		const file = path.join(dir, "codegraph.json");
		fs.mkdirSync(dir, { recursive: true });

		let data = {};
		try {
			data = JSON.parse(fs.readFileSync(file, "utf8")) || {};
		} catch {
			/* missing/invalid -> start fresh */
		}

		const n = Number.isFinite(data.queries) ? Math.max(0, Math.floor(data.queries)) : 0;
		data.queries = n + 1;
		data.updatedAt = new Date().toISOString();
		fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
	}
} catch {
	/* never block a tool call */
}

process.exit(0);
