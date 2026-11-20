# Changelog

## 4.0.0 — 2026-11-20
Based on two rounds of field feedback from an agent using v3 on Windows and Linux.
- **One Node entry point** (`scripts/cli.mjs`) for everything: run, `wait`, `doctor`, `install`, `--version`. Same on every OS; no bash required.
- **`agy-run doctor`**: checks Node 18+, agy, a Neon model, credentials (one tiny call; `--offline` skips), launchers and which version they run, PATH, and the fish / shell-greeting problems. Prints a one-line fix per problem; `--json` for machines, `--out FILE` to check the Terminal panel's own shell.
- **Install from the bundled copy**: `node <plugin>/scripts/cli.mjs install`. No clone, no network. Writes `.cmd` launchers on Windows (plus sh launchers for Git Bash; `.ps1` only with `--ps1`, since execution policy often blocks them) and sh launchers elsewhere.
- **No version drift**: every launcher runs `launch.mjs`, which picks the newest installed plugin copy (then the local fallback). `agy-run --version` shows what runs. Pre-v4 launchers still work and pick up v4.
- **`--no-tab` headless mode**: same runner, no live view, prints the agy-wait report; replaces hand-rolled `agy -p "$(cat brief)"`, which broke in PowerShell.
- **Briefs go to agy on stdin**, never on the command line: no shell quoting bugs, no Windows length limit, on every platform. agy.exe is run directly; cmd.exe is used only for a `.cmd`/`.bat` agy launcher, and then only for short arguments. (`AGY_BRIEF_MODE=file` sends a "read this file" prompt instead.)
- **`doctor --smoke`**: sends a realistic brief (multi-line, quotes, backticks, `#`, `$`, `%`, `&`, `|`, unicode) through agy-run on the cheapest model and checks it arrives intact.
- **`agy-run demo`**: a throwaway tiny project; the cheapest model analyses it and fixes a one-line bug with `--mode accept-edits`; checks the fix, scope and brief, then cleans up. Proves auth, quota and quoting in one go.
- **`--cwd DIR`**: start the Terminal tab anywhere `run_in_terminal` allows and run Gemini in a worktree or work copy.
- **Failure hints**: the done line and report carry `hint=` for common causes (not signed in, unknown model, time limit, network, "agy rejected the arguments: an agy-run bug"). Missing agy exits 127.
- `latest.*` falls back to copies where symlinks aren't allowed (Windows). ASCII icons on old Windows consoles (`AGY_ASCII`).
- **Pre-edit copies**: the first version of every file Gemini changes is saved in `~/.cache/agy-runs/<stamp>.before/` and listed in the report, so non-git projects can be reviewed and reverted.
- Windows path handling (`C:\`, `C:/`, `/c/`), `latest.json` pointer, `agy-wait --file`.
- **Skill rewrite**: decision tree first; setup is the doctor; platform notes (which shell runs what, path styles, `run_in_terminal` one-line limits, agy install per OS); edit tasks (`--mode accept-edits`, `--add-dir`, non-git review recipe, cleanup); model sizing ("quick" → Flash); a brief checklist; report agy-run bugs upstream instead of patching installed copies; troubleshooting appendix.

## 3.1.0 — 2026-11-20
- The `agy-run` / `agy-wait` launchers now run the newest installed plugin version of the code (falling back to `~/.local/share/agy-run`), so the tools update together with the plugin. `install.sh` becomes a one-time step.
- Without `install.sh`, the skill runs the scripts straight from the plugin folder.

## 3.0.0 — 2026-11-20
- **Live diffs in the Terminal tab.** `agy-run` is now a Node runner (`agy-run.mjs`) that snapshots each file before Gemini edits it and prints a colored diff the moment the edit lands, plus every read, search and command (with output), a live status line with a timer, and a files-changed summary at the end.
- **No more polling.** New `agy-wait BRIEF` blocks until the run finishes; Claude runs it as a background command and gets woken with a compact report (status, attempts, files changed, stderr on failure, full answer). It also catches runs that never started in the tab or died.
- **Rate-limit detection + model step-down.** Three error/retry steps in a row, or a RESOURCE_EXHAUSTED/429, stops the attempt early with status `RATE_LIMITED` (exit 75) and suggests `next=` (one step down) and `next_family=` models from a configurable ladder (`AGY_LADDER` or `~/.config/agy-run/ladder`). The skill asks before stepping down; `--descend` (and `--floor MODEL`) lets it step down automatically when the user allows it, only while no files were edited.
- Replaces `agy-watch.mjs`. Re-run `install.sh` to update.

## 2.0.0 — 2026-11-19
- Visible runs: Gemini runs in a Terminal-panel tab via the `agy-run` wrapper, with a live formatter (`agy-watch.mjs`), per-run logs in `~/.cache/agy-runs`, and a `[agy-run done: ...]` completion line Claude watches for.
- Headless JSON mode kept as the fallback.
- Failure handling for Google rate limits / retry loops.
