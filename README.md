# agy-run · Gemini Neon subagent for Claude

A Claude skill (`gemini-neon-subagent`) that lets Claude delegate bounded subtasks — research, drafts, refactors, reviews, parallel work — to **Gemini 4 Neon** through the Antigravity CLI (`agy`). In the Claude desktop app, Gemini runs in a Terminal-panel tab so you can watch it work; Claude writes the brief, reads the result, and verifies it.

## Requirements

- [Antigravity CLI](https://antigravity.google) (`agy`), signed in once interactively, with access to a `gemini-4-neon-*` model (paid Google AI plan or `GEMINI_API_KEY`)
- Node.js (for the live formatter)
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

**2. Install the `agy-run` wrapper** (for the live Terminal-tab view; without it the skill falls back to hidden headless runs):

```bash
git clone https://github.com/JassV9/agy-run.git && ./agy-run/install.sh
```

This puts `agy-run` in `~/.local/bin` and its formatter in `~/.local/share/agy-run/`.

### claude.ai (web / desktop Chat tab)

Download `gemini-neon-subagent-<version>.zip` from the [latest release](https://github.com/JassV9/agy-run/releases/latest) and upload it under **Settings → Capabilities → Skills**. Note the skill still needs a shell that reaches your machine, so it's most useful in the Code tab.

## Updating

```bash
claude plugin marketplace update agy-run && claude plugin update gemini-neon-subagent@agy-run
```

Re-run `./install.sh` after `git pull` if the wrapper changed (see [CHANGELOG](CHANGELOG.md)).

## Usage

Just ask Claude to hand something to Gemini, e.g. *"have Gemini review src/auth for bugs while you write the tests"*. Claude writes a brief, runs `agy-run gemini-4-neon-high <brief>` in a new Terminal tab, waits for the `[agy-run done: …]` line, then reads and checks the answer. Run logs are kept in `~/.cache/agy-runs/`.

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
  scripts/agy-run                 wrapper: live view + logs + done line
  scripts/agy-watch.mjs           stream-json → readable terminal output
install.sh                        installs the wrapper to ~/.local
release.sh                        tag + GitHub release + claude.ai zip
```

## License

MIT
