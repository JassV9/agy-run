#!/usr/bin/env bash
# Installs the agy-run tools the skill uses for visible (Terminal-tab) runs:
#   ~/.local/bin/agy-run, ~/.local/bin/agy-wait   launchers
#   ~/.local/share/agy-run/*.mjs                  the code they run
# Needs: agy (Antigravity CLI), node 18+, and git or diff (for the live diffs).
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)/skills/gemini-neon-subagent/scripts"
BIN="$HOME/.local/bin" SHARE="$HOME/.local/share/agy-run"
mkdir -p "$BIN" "$SHARE"
install -m 644 "$SRC/agy-run.mjs" "$SRC/agy-wait.mjs" "$SHARE/"
install -m 755 "$SRC/agy-run" "$SRC/agy-wait" "$BIN/"
rm -f "$SHARE/agy-watch.mjs"   # replaced by agy-run.mjs in v3
echo "Installed agy-run and agy-wait to $BIN"
command -v node >/dev/null || echo "warning: node not found; agy-run needs Node 18+"
command -v agy  >/dev/null || echo "warning: agy not found; install Antigravity CLI: curl -fsSL https://antigravity.google/cli/install.sh | bash"
command -v git >/dev/null || command -v diff >/dev/null || echo "warning: neither git nor diff found; edits will show without diffs"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "warning: $BIN is not on your PATH";; esac
