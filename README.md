# agy-run · Gemini Neon subagent for Claude

A Claude skill (`gemini-neon-subagent`) that lets Claude delegate bounded subtasks — research, drafts, refactors, reviews, parallel work — to **Gemini 4 Neon** through the Antigravity CLI (`agy`). In the Claude desktop app, Gemini runs in a Terminal-panel tab so you can watch it work: every read and command, a colored diff of each edit as it lands, the answer streaming in. Claude writes the brief, gets woken when Gemini finishes, and verifies the result. Linux, macOS and Windows.

## Requirements

- [Antigravity CLI](https://antigravity.google) (`agy`), signed in once interactively, with a `gemini-4-neon-*` model (paid Google AI plan or `GEMINI_API_KEY`). Linux/macOS: `curl -fsSL https://antigravity.google/cli/install.sh | bash`; Windows: the installer from antigravity.google.
- Node.js 18+, and git (or diff) for the live diffs.
- Claude Code or the Claude desktop app's Code tab (the skill needs a shell on your machine).

## Install

**1. Add the plugin:**

```bash
claude plugin marketplace add JassV9/agy-run && claude plugin install gemini-neon-subagent@agy-run
```

(or in Claude: `/plugin marketplace add JassV9/agy-run`, then `/plugin install gemini-neon-subagent@agy-run`)

**2. Turn on auto-update** (third-party marketplaces have it off by default): run `claude` in a terminal, open `/plugin` → Marketplaces → `agy-run` → enable auto-update.

**3. Optional: short commands on PATH.** Ask Claude to "set up agy-run", or run the installer from the plugin's own bundled copy (no download):

```bash
node ~/.claude/plugins/cache/agy-run/gemini-neon-subagent/<version>/skills/gemini-neon-subagent/scripts/cli.mjs install
```

It writes `agy-run` and `agy-wait` launchers to `~/.local/bin` (`.cmd` files on Windows, plus sh launchers for Git Bash) and a fallback copy to `~/.local/share/agy-run` (`%LOCALAPPDATA%\agy-run` on Windows). The launchers always run the newest installed plugin version, so this is a one-time step. Without it, Claude runs `node <scripts>/cli.mjs` directly.

**4. Check and try it:**

```bash
agy-run doctor --smoke
```

```bash
agy-run demo
```

`doctor` checks everything (Node, agy, Neon access, credentials, launchers, PATH, known shell problems) and prints a one-line fix for each problem; `--smoke` also pushes a realistic brief through the whole pipeline. `demo` runs a safe end-to-end example in a throwaway folder (analysis + a one-line fix on the cheapest model) and cleans up.

## Updating

With auto-update on, new versions install when Claude starts. Manually:

```bash
claude plugin marketplace update agy-run && claude plugin update gemini-neon-subagent@agy-run
```

## Usage

Ask Claude to hand something to Gemini, e.g. *"have Gemini review src/auth for bugs while you write the tests"* or *"quick: get Gemini to summarise this log"*. Claude:

1. writes a brief and runs `agy-run gemini-4-neon-high <brief> --cwd <work dir>` in a new Terminal tab, where you watch Gemini work;
2. runs `agy-wait <brief>` in the background, so it's woken when Gemini finishes instead of burning tokens polling;
3. reviews the result (files changed, pre-edit copies, the answer) before using it.

Without a Terminal panel, the same runner works headless: `agy-run <model> <brief> --no-tab`.

**Rate limits:** `agy-run` spots a rate limit within about a minute and stops with `RATE_LIMITED` (exit 75), naming the next model down (`next=gemini-4-neon-medium`, `next_family=gemini-3.8-flash-high`). Claude asks whether to step down; say "keep stepping down" and it adds `--descend` (optionally `--floor MODEL`). Change the ladder with `AGY_LADDER="model1 model2 …"` or `~/.config/agy-run/ladder`.

**Commands**

```
agy-run MODEL BRIEF [--cwd DIR] [--no-tab] [--descend] [--floor MODEL] [agy flags...]
agy-wait BRIEF [--timeout S] [--resume]      agy-wait --file PATH
agy-run doctor [--json] [--out FILE] [--offline] [--smoke]
agy-run demo [--model M] [--no-tab] [--keep]
agy-run install [--ps1] [--dry-run]
agy-run --version
```

Settings (env): `AGY_DIFF_LINES` (diff lines per edit, default 80), `AGY_RATE_LIMIT_ERRORS` (default 3), `AGY_PRINT_TIMEOUT` (default 15m), `AGY_RUN_DIR` (logs, default `~/.cache/agy-runs`), `AGY_ASCII` (1/0: ASCII icons), `AGY_BRIEF_MODE` (`stdin` default, or `file`), `AGY_RUN_HOME` (force a scripts folder).

## Releasing a new version (maintainer)

1. Edit the skill / scripts.
2. Bump the version in `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` **and** `VERSION` in `skills/gemini-neon-subagent/scripts/common.mjs`; add a CHANGELOG entry.
3. Commit and push, then `./release.sh`: it checks the three versions match and the tree is clean, tags `vX.Y.Z`, and publishes a GitHub release with a claude.ai zip.

Users only get an update when the version number changes.

## Layout

```
.claude-plugin/marketplace.json   marketplace "agy-run"
.claude-plugin/plugin.json        plugin "gemini-neon-subagent" + version
skills/gemini-neon-subagent/
  SKILL.md                        the skill
  scripts/cli.mjs                 single entry point (run, wait, doctor, demo, install)
  scripts/run.mjs                 runner: live view, diffs, rate limits, done-file
  scripts/wait.mjs                background watcher
  scripts/doctor.mjs, demo.mjs, install.mjs
  scripts/launch.mjs              launcher target: picks the newest installed copy
  scripts/common.mjs              shared helpers + VERSION
  scripts/agy-run.mjs, agy-wait.mjs   compatibility entries for pre-v4 launchers
install.sh                        for a git checkout: same as `agy-run install`
release.sh                        tag + GitHub release + claude.ai zip
```

## License

MIT
