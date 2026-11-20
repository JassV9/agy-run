# agy-run · Gemini Neon subagent for Claude

A Claude skill (`gemini-neon-subagent`) that lets Claude delegate bounded subtasks — research, drafts, refactors, reviews, parallel work — to **Gemini 4 Neon** through the Antigravity CLI (`agy`). In the Claude desktop app, Gemini runs in a Terminal-panel tab so you can watch it work; Claude writes the brief, reads the result, and verifies it.

## Requirements

- [Antigravity CLI](https://antigravity.google) (`agy`), signed in once interactively, with access to a `gemini-4-neon-*` model (paid Google AI plan or `GEMINI_API_KEY`)
- Node.js 18+ and git (or diff) for the live view and diffs
- Claude Code / the Claude desktop app's Code tab (the skill needs a shell on your machine)

## Install

**1. Add the plugin** (Claude desktop Code tab or Claude Code):

```
/plugin marketplace add JassV9/agy-run
/plugin install gemini-neon-subagent@agy-run
```

Or from a terminal:

```bash
claude plugin marketplace add JassV9/agy-run && claude plugin install gemini-neon-subagent@agy-run
```

**2. Install the `agy-run` tools** (the live Terminal-tab view and the `agy-wait` watcher; without them the skill falls back to hidden headless runs):

```bash
git clone https://github.com/JassV9/agy-run.git && ./agy-run/install.sh
```

This puts `agy-run` and `agy-wait` in `~/.local/bin` and their code in `~/.local/share/agy-run/`. To update later: `git -C agy-run pull && ./agy-run/install.sh`.

### claude.ai (web / desktop Chat tab)

Download `gemini-neon-subagent-<version>.zip` from the [latest release](https://github.com/JassV9/agy-run/releases/latest) and upload it under **Settings → Capabilities → Skills**. Note the skill still needs a shell that reaches your machine, so it's most useful in the Code tab.

## Updating

```bash
claude plugin marketplace update agy-run && claude plugin update gemini-neon-subagent@agy-run
```

Re-run `./install.sh` after `git pull` if the wrapper changed (see [CHANGELOG](CHANGELOG.md)).

## Usage

Just ask Claude to hand something to Gemini, e.g. *"have Gemini review src/auth for bugs while you write the tests"*. Claude:

1. writes a brief and runs `agy-run gemini-4-neon-high <brief>` in a new Terminal tab, where you watch Gemini work: every read, search and command, a colored diff of each file edit as it lands, and the answer streaming in;
2. runs `agy-wait <brief>` in the background, so it gets woken when Gemini finishes instead of burning tokens polling;
3. reviews the result (files changed, answer) before using it.

**Rate limits:** `agy-run` spots a rate limit within about a minute and stops with `RATE_LIMITED`, naming the next model down (`next=gemini-4-neon-medium`, `next_family=gemini-3.8-flash-high`). Claude asks whether to step down. Tell it to "keep stepping down" and it adds `--descend` (optionally `--floor MODEL`) so the runner retries down the ladder by itself. Change the ladder with `AGY_LADDER="model1 model2 …"` or a `~/.config/agy-run/ladder` file.

Other knobs: `AGY_DIFF_LINES` (diff lines shown per edit, default 80), `AGY_RATE_LIMIT_ERRORS` (default 3), `AGY_PRINT_TIMEOUT` (default 15m), `AGY_RUN_DIR` (logs, default `~/.cache/agy-runs`).

## Releasing a new version (maintainer)

1. Edit `skills/gemini-neon-subagent/SKILL.md` (and scripts if needed).
2. Bump `version` in `.claude-plugin/plugin.json` **and** `.claude-plugin/marketplace.json`, add a CHANGELOG entry.
3. `./release.sh` — commits nothing itself; it checks the versions match, tags `vX.Y.Z`, pushes the tag, and publishes a GitHub release with the claude.ai zip.

Users only get an update when the version number changes.

## Layout

```
.claude-plugin/marketplace.json   marketplace "agy-run" (lists this repo as one plugin)
.claude-plugin/plugin.json        plugin "gemini-neon-subagent" + version
skills/gemini-neon-subagent/
  SKILL.md                        the skill
  scripts/agy-run.mjs             runner: live view, diffs, rate-limit step-down, done-file
  scripts/agy-wait.mjs            background watcher Claude waits on
  scripts/agy-run, agy-wait       launchers installed to ~/.local/bin
install.sh                        installs the tools to ~/.local
release.sh                        tag + GitHub release + claude.ai zip
```

## License

MIT
