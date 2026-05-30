# bump-graphify.ps1
# Increments the Graphify "queries" counter that the Token Savings Stream Deck
# plugin reads. Wire it to a Claude Code PreToolUse hook on Grep|Glob — those are
# the calls Graphify intercepts to send Claude to the graph, so each one is a
# reasonable proxy for "a graph-backed query happened."
#
# It always exits 0 so it can NEVER block a tool call.

$ErrorActionPreference = 'SilentlyContinue'

$file = Join-Path $HOME '.tokensaver\graphify.json'
$dir  = Split-Path $file
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

$n = 0
if (Test-Path $file) {
    try { $n = [int]((Get-Content $file -Raw | ConvertFrom-Json).queries) } catch { $n = 0 }
}

"{ `"queries`": $($n + 1) }" | Set-Content -Path $file -Encoding utf8

exit 0
