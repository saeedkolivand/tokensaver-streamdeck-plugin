# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue for them.

- Preferred: GitHub's [private vulnerability reporting](https://github.com/saeedkolivand/tokensaver-streamdeck/security/advisories/new)
  (the **Security** tab → *Report a vulnerability*).
- Or email **saeedkolivand1997@gmail.com** with details and steps to reproduce.

You can expect an acknowledgement within a few days. Please give a reasonable
window to release a fix before any public disclosure. This is a small
community project maintained on a best-effort basis.

## Supported versions

Only the latest released version receives fixes. Please confirm a report against
the current `main` / latest release before filing.

## What this plugin accesses, and where data goes

By design, the plugin runs locally and is intentionally narrow in what it touches:

- It runs your local **RTK** command (`rtk gain --all --format json`) to read the
  savings figures RTK already tracks on this machine.
- It reads local **Graphify** output (`graphify-out/cost.json`) for the projects you
  point it at, to compute the Graphify estimate.
- It reads and writes the plugin's own settings via the Stream Deck app.
- It has **no analytics or telemetry** and makes no network calls of its own —
  nothing is sent to any third party.

If you believe any of the above is not true in practice (for example, data leaving
the machine, or an unexpected command being executed), that's a security issue —
please report it using the private channels above.

## Out of scope

These are known characteristics, not vulnerabilities:

- **Estimates are estimates.** The Graphify, Total, and Money readouts are marked
  `≈` and can be negative until queries pay back the graph build — see the README
  "How the numbers work". That is expected behavior, not a flaw.
- **External tools.** RTK and Graphify are separate third-party tools with their own
  security posture; issues in those tools belong in their own trackers.
- A readout showing dashes because RTK or Graphify isn't installed is expected, not
  a security flaw.
