# Changelog

## 2.0.0 — 2026-11-19
- Visible runs: Gemini runs in a Terminal-panel tab via the `agy-run` wrapper, with a live formatter (`agy-watch.mjs`), per-run logs in `~/.cache/agy-runs`, and a `[agy-run done: ...]` completion line Claude watches for.
- Headless JSON mode kept as the fallback.
- Failure handling for Google rate limits / retry loops.
