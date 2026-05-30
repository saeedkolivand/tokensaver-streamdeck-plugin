# Token Savings — Stream Deck plugin

A single Stream Deck key that shows how many AI-coding tokens you've saved with
[**RTK** (Rust Token Killer)](https://www.rtk-ai.app/) and [**Graphify**](https://graphify.net/).
Tap to cycle three readouts, or pin a key to one.

![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)
![Platforms](https://img.shields.io/badge/run%20on-macOS%20%7C%20Windows-blue.svg)
![Stream Deck](https://img.shields.io/badge/Stream%20Deck-6.5%2B-black.svg)
![Node](https://img.shields.io/badge/build%20with-Node%2020%2B-339933.svg)

![Preview of the three key readouts: RTK, Graphify, and Total](docs/preview.png)

---

## Contents

- [What it shows](#what-it-shows)
- [How the numbers work (read this)](#how-the-numbers-work-read-this)
- [Requirements](#requirements)
- [Install](#install)
  - [A. Prebuilt (recommended)](#a-prebuilt-recommended)
  - [B. Build from source (any OS)](#b-build-from-source-any-os)
  - [Plugin folder locations](#plugin-folder-locations)
- [Configure](#configure)
- [Make the Graphify number real](#make-the-graphify-number-real)
  - [macOS / Linux](#macos--linux)
  - [Windows](#windows)
- [Modes & layout](#modes--layout)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Cutting a release](#cutting-a-release)
- [Project structure](#project-structure)
- [License](#license)

---

## What it shows

Tap the key to cycle three readouts (or pin one in settings):

| Readout | Colour | Source | Trust |
| --- | --- | --- | --- |
| **RTK** | green | parsed from `rtk gain` | **measured** — RTK diffs raw vs compressed command output and keeps a SQLite ledger |
| **GRAPHIFY** | amber | `cost.json` (real spend) − `queries × tokens/query` | **net estimate** |
| **TOTAL** | blue | RTK + Graphify net | **approximate** (`≈`) |

Place the action on three keys, each pinned to a different readout, to see all three at once.

## How the numbers work (read this)

The whole point of this plugin is to be honest about what's measured vs estimated.

- **RTK is measured.** RTK compresses command output (`grep`, `find`, `cargo test`,
  `git diff`…) and records the real before/after token counts. The plugin parses
  `rtk gain`, so the RTK figure is empirical.

- **Graphify is split.** Graphify builds a knowledge graph of your codebase so the
  assistant traverses the graph instead of re-reading raw files. It logs what it
  **spent** (the LLM tokens used during extraction) in `graphify-out/cost.json`, but it
  **never logs the savings** — there's no per-query saving or query count anywhere in
  `graphify-out/`. So the Graphify readout is **net = estimated savings − real cost**:
  `queries × tokens/query` (estimate, default `121300` from the ~123k → ~1.7k benchmark)
  minus what `cost.json` says you spent. It's negative until queries pay back the build,
  which is the honest picture. With no query count set, it shows the real spend as a
  negative number.

- **The combined total is approximate.** Both tools hook Claude Code's Grep/Glob. If
  Graphify diverts a grep to the graph, that grep never runs, so RTK never sees it to
  compress — the two partly contend for the same operations. The plugin marks the combined
  value `≈` for this reason. Don't treat it as exact.

> **What `cost.json` contains:** `{ total_input_tokens, total_output_tokens, runs: [...] }`
> — the tokens Graphify burned on semantic extraction. It is a **cost** ledger, not savings.

## Requirements

**To run:** the official [Elgato Stream Deck app](https://www.elgato.com/downloads) **6.5 or
newer**, on **macOS 12+** or **Windows 10+**. The plugin runs on the Node.js runtime the
Stream Deck app ships — you don't install Node to *run* it.

> **Linux:** not supported for running. Elgato's Stream Deck app is macOS/Windows only, and
> community Linux tools (e.g. `streamdeck_ui`) don't load Elgato SDK plugins. You can still
> *build* the plugin on Linux; the output is only usable on a macOS/Windows machine.

**For the readouts (optional, install whichever you use):**

- **RTK** — the `rtk` binary must be on your `PATH`. See <https://www.rtk-ai.app/> and
  install per its docs.
- **Graphify** — see <https://graphify.net/>. You point the plugin at a project's
  `graphify-out/` folder.

**To build from source:** [Node.js 20+](https://nodejs.org) (any OS).

## Install

### A. Prebuilt (recommended)

1. Download the latest `com.tokensaver.dashboard.streamDeckPlugin` from this repo's
   **Releases** page.
2. Quit the Stream Deck app, then **double-click** the file. It installs/updates the plugin.
3. Reopen Stream Deck and drag **Token Savings** onto a key.

### B. Build from source (any OS)

```bash
git clone https://github.com/<you>/tokensaver-streamdeck.git
cd tokensaver-streamdeck
npm install
npm run build        # bundles src/ -> com.tokensaver.dashboard.sdPlugin/bin/plugin.js
```

Then either pack it into an installable file:

```bash
npm i -g @elgato/cli
streamdeck pack com.tokensaver.dashboard.sdPlugin     # -> com.tokensaver.dashboard.streamDeckPlugin
```

…and double-click the result, **or** link it for live development (see
[Development](#development)).

### Plugin folder locations

If you prefer to copy the `com.tokensaver.dashboard.sdPlugin/` folder in by hand, drop it
here and restart the Stream Deck app:

| OS | Path |
| --- | --- |
| macOS | `~/Library/Application Support/com.elgato.StreamDeck/Plugins/` |
| Windows | `%APPDATA%\Elgato\StreamDeck\Plugins\` |

## Configure

Select the key, then open the property inspector:

| Field | What it does |
| --- | --- |
| **Mode** | `Cycle on tap` (default), or pin to RTK / Graphify / Combined. |
| **RTK command** | Defaults to `rtk gain`. If your `rtk` exposes a structured flag (check `rtk gain --help`), point this at it. |
| **Refresh (sec)** | Poll interval, 5–300 (default 30). |
| **Graphify ~tokens/query** | Per-query saving estimate (default `121300`). |
| **Graphify out / cost.json** | Path to your project's `graphify-out` folder (or the `cost.json` inside it). Reads the **real** tokens Graphify spent. |
| **Graphify queries** | Manual query count for the estimate; used when no stats file is set. |
| **Graphify stats file** | Optional JSON (`{ "queries": N }`) holding a live query count (see below). |

Path examples for the two path fields:

| OS | Graphify out / cost.json | Graphify stats file |
| --- | --- | --- |
| macOS / Linux | `~/code/myproject/graphify-out` | `~/.tokensaver/graphify.json` |
| Windows | `C:\Users\You\code\myproject\graphify-out` | `C:\Users\You\.tokensaver\graphify.json` |

(The plugin expands a leading `~` to your home directory on every OS.)

## Make the Graphify number real

The **cost** side is real as soon as you set **Graphify out / cost.json**. The **savings**
side needs a query count, which Graphify doesn't track — so you maintain a small
`{ "queries": N }` file and (optionally) auto-increment it from a Claude Code
[PreToolUse hook](https://code.claude.com/docs/en/hooks-guide) on `Grep|Glob` (the calls
Graphify intercepts). Counting Grep/Glob is a **proxy** for "a graph query happened," so the
result stays an estimate — that's what the `≈` means.

The script always exits `0`, so it can never block a tool call. The `scripts`/`hooks` for
both platforms ship in this repo under `hooks/`.

### macOS / Linux

`hooks/bump-graphify.sh`:

```bash
#!/usr/bin/env bash
file="${HOME}/.tokensaver/graphify.json"
mkdir -p "$(dirname "$file")"
n=0
if [ -f "$file" ]; then
  n=$(grep -oE '[0-9]+' "$file" | head -n1); [ -z "$n" ] && n=0
fi
printf '{ "queries": %d }\n' "$((n + 1))" > "$file"
exit 0
```

Install it and make it executable:

```bash
mkdir -p ~/.tokensaver
cp hooks/bump-graphify.sh ~/.tokensaver/bump-graphify.sh
chmod +x ~/.tokensaver/bump-graphify.sh
```

Add a hook in `~/.claude/settings.json` (the easiest route is to run `/hooks` in Claude
Code and let it merge for you):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Grep|Glob",
        "hooks": [
          { "type": "command", "command": "\"$HOME/.tokensaver/bump-graphify.sh\"" }
        ]
      }
    ]
  }
}
```

Then set the plugin's **Graphify stats file** to `~/.tokensaver/graphify.json`.

### Windows

`hooks/bump-graphify.ps1`:

```powershell
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
```

Copy it to `%USERPROFILE%\.tokensaver\bump-graphify.ps1`, then add a hook in
`%USERPROFILE%\.claude\settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Grep|Glob",
        "hooks": [
          {
            "type": "command",
            "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"%USERPROFILE%\\.tokensaver\\bump-graphify.ps1\""
          }
        ]
      }
    ]
  }
}
```

Then set the plugin's **Graphify stats file** to `C:\Users\You\.tokensaver\graphify.json`.

> If Graphify already added a `PreToolUse` / `Grep|Glob` hook, don't overwrite it — add this
> command into that matcher's existing `hooks` array, or add a second matcher object.

> **Split machines (WSL / remote):** the stats file must be readable by the machine running
> the Stream Deck app. If Claude Code runs elsewhere, write the counter to a shared/synced
> path and point the plugin field there.

## Modes & layout

- **Cycle on tap** — each press advances RTK → Graphify → Total.
- **Pinned** — lock the key to one readout; a press just forces a refresh.
- **All three at once** — drop the action on three keys and pin each to a different readout.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| RTK shows `—` / `rtk?` | `rtk` isn't on the Stream Deck app's `PATH`, or `rtk gain` failed. Try the full path in **RTK command**. |
| Graphify shows a **negative** number | Expected — that's the real `cost.json` spend, not yet offset by query savings. Set a query count. |
| Graphify still `~0` | No **Graphify out / cost.json** path and no query count. Set at least one. |
| `pack` fails: `must contain property: CodePath` / `UUID` | The manifest is missing top-level `UUID` / `CodePath`. This repo's manifest already includes them — make sure you're packing the repo's version. |
| Update didn't apply | Quit the Stream Deck app first, bump the manifest `Version`, then reinstall (`streamdeck pack --version 1.0.2.0`). |
| Property inspector looks blank | It loads `sdpi-components` from a CDN and needs internet on first open; or your install is an older build (no **Graphify out / cost.json** field). |
| Key sub-label says `est · 0q` | You're on an old build. Reinstall — the current build shows `spent · N runs`. |

## Development

```bash
npm run build        # one-off bundle
npm run watch        # rebuild on change

npm i -g @elgato/cli
streamdeck link com.tokensaver.dashboard.sdPlugin   # register for live dev (once)
streamdeck restart com.tokensaver.dashboard         # reload after a build
```

The bundle is self-contained: Rollup inlines the SDK and leaves only Node built-ins
external, so the installed `.sdPlugin` needs no `node_modules`.

## Cutting a release

```bash
npm run build
streamdeck pack com.tokensaver.dashboard.sdPlugin --version 1.0.2.0 --force
```

Attach the resulting `com.tokensaver.dashboard.streamDeckPlugin` to a GitHub Release.
`pack` validates the manifest and strips dev artifacts (source maps) automatically.

## Project structure

```
src/
  plugin.ts          entry: registers the action, connects
  token-savings.ts   the action — per-key timer, mode cycling, rendering
  sources.ts         rtk gain parser + Graphify cost.json/estimate + number formatting
  render.ts          SVG key face -> data URI for setImage
com.tokensaver.dashboard.sdPlugin/
  manifest.json      plugin + action declaration
  bin/plugin.js      built bundle (self-contained)
  ui/                property inspector
  imgs/              icons
hooks/
  bump-graphify.sh   macOS/Linux query counter
  bump-graphify.ps1  Windows query counter
docs/
  preview.png        readme image
```

## License

MIT.
