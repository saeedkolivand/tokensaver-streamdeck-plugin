# Contributing

Thanks for your interest in improving the Token Savings Stream Deck plugin!
This is a small, focused project, so the workflow is light.

## Ways to help

- **Report a bug** or **request a readout/feature** via the issue templates.
- **Improve the docs** (README, this file).
- **Send a pull request** for a fix or a new readout.

By participating you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Project layout

```
src/plugin.ts          Stream Deck entry point — registers the action and connects
src/token-savings.ts   the action: settings, the tap-to-cycle logic, refresh loop
src/sources.ts         data layer: reads RTK (`rtk gain --all --format json`) and
                       Graphify (`graphify-out/cost.json`) and computes each readout
src/render.ts          turns a readout into the key image
hooks/track-graphify.mjs  hook that counts real `graphify query` runs and records
                          each project's cost.json path (feeds the Graphify estimate)
scripts/make-preview.ts   regenerates docs/preview.png
com.tokensaver.dashboard.sdPlugin/
  manifest.json        plugin + action definition (Node 20 runtime, Windows + macOS)
  bin/plugin.js        bundled output — generated, committed, do not hand-edit
  ui/token-savings.html the settings panel (mode, rates, paths)
  imgs/                icons
```

Keep the data/measurement logic in `sources.ts` and the Stream Deck glue in
`token-savings.ts` / `plugin.ts`.

## Development setup

Requires Node 20+ (any OS).

```bash
npm install
npm run build      # rollup bundles src/ -> com.tokensaver.dashboard.sdPlugin/bin/plugin.js
npm run watch      # rebuild on change during development
npm run preview    # regenerate docs/preview.png
```

`bin/plugin.js` is the artifact the Stream Deck app actually runs, and it **is
committed**. Always edit the TypeScript in `src/`, then re-run `npm run build` so
the bundle stays in sync. PRs that change `src/` but not the rebuilt `bin/plugin.js`
will be asked to rebuild.

Validate and (optionally) package the plugin:

```bash
npm i -g @elgato/cli
streamdeck validate com.tokensaver.dashboard.sdPlugin
streamdeck pack com.tokensaver.dashboard.sdPlugin
```

## Honesty about the numbers

This plugin's whole point is being clear about **measured vs estimated** values
(see "How the numbers work" in the README). Please preserve that:

- **RTK / Today / Week / Month** are measured — don't blend estimates into them.
- **Graphify / Total / Money** are estimates and are marked `≈`. If you change how
  an estimate is derived, update the README so the distinction stays accurate.

## Testing

There's no formal test runner. Please sanity-check changes against a real key, and
for data changes verify against the underlying source (e.g. compare a readout to
`rtk gain --all --format json`). Note which OS you tested on.

## Style

- Match the surrounding code: small focused functions, comments where the *why*
  isn't obvious, no new dependencies unless necessary.
- TypeScript, ES modules, 2-space indent.

## Pull requests

- Branch off `main`, keep PRs focused.
- Fill in the PR template checklist (rebuilt bundle, `validate` clean, platforms
  tested).
- Test on **Windows** and/or **macOS** — the plugin supports both.
