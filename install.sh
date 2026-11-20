#!/usr/bin/env sh
# For a git checkout: same as `agy-run install` (uses the scripts in this checkout).
# Plugin users don't need this: run  node "<plugin scripts dir>/cli.mjs" install
exec node "$(cd "$(dirname "$0")" && pwd)/skills/gemini-neon-subagent/scripts/cli.mjs" install "$@"
