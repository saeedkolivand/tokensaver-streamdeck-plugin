#!/usr/bin/env bash
# bump-graphify.sh
# Increments the Graphify "queries" counter that the Token Savings Stream Deck
# plugin reads. Wire it to a Claude Code PreToolUse hook on Grep|Glob — those are
# the calls Graphify intercepts to send Claude to the graph, so each one is a
# reasonable proxy for "a graph-backed query happened."
#
# Always exits 0 so it can NEVER block a tool call.

file="${HOME}/.tokensaver/graphify.json"
mkdir -p "$(dirname "$file")"

n=0
if [ -f "$file" ]; then
  n=$(grep -oE '[0-9]+' "$file" | head -n1)
  [ -z "$n" ] && n=0
fi

printf '{ "queries": %d }\n' "$((n + 1))" > "$file"
exit 0
