# Changelog

## 3.0.0 — 2026-11-20
- **Live diffs in the Terminal tab.** `agy-run` is now a Node runner (`agy-run.mjs`) that snapshots each file before Gemini edits it and prints a colored diff the moment the edit lands, plus every read, search and command (with output), a live status line with a timer, and a files-changed summary at the end.
- **No more polling.** New `agy-wait BRIEF` blocks until the run finishes; Claude runs it as a background command and gets woken with a compact report (status, attempts, files changed, stderr on failure, full answer). It also catches runs that never started in the tab or died.
- **Rate-limit detection + model step-down.** Three error/retry steps in a row, or a RESOURCE_EXHAUSTED/429, stops the attempt early with status `RATE_LIMITED` (exit 75) and suggests `next=` (one step down) and `next_family=` models from a configurable ladder (`AGY_LADDER` or `~/.config/agy-run/ladder`). The skill asks before stepping down; `--descend` (and `--floor MODEL`) lets it step down automatically when the user allows it, only while no files were edited.
- Replaces `agy-watch.mjs`. Re-run `install.sh` to update.

## 2.0.0 — 2026-11-19
- Visible runs: Gemini runs in a Terminal-panel tab via the `agy-run` wrapper, with a live formatter (`agy-watch.mjs`), per-run logs in `~/.cache/agy-runs`, and a `[agy-run done: ...]` completion line Claude watches for.
- Headless JSON mode kept as the fallback.
- Failure handling for Google rate limits / retry loops.
