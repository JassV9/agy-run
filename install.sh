#!/usr/bin/env bash
# Installs the agy-run wrapper the skill uses for visible (Terminal-tab) runs.
#   ~/.local/bin/agy-run                  the wrapper
#   ~/.local/share/agy-run/agy-watch.mjs  the live formatter it pipes through
# Needs: agy (Antigravity CLI) and node on PATH.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)/skills/gemini-neon-subagent/scripts"
mkdir -p "$HOME/.local/bin" "$HOME/.local/share/agy-run"
install -m 755 "$SRC/agy-run" "$HOME/.local/bin/agy-run"
install -m 644 "$SRC/agy-watch.mjs" "$HOME/.local/share/agy-run/agy-watch.mjs"
echo "Installed agy-run to ~/.local/bin/agy-run"
command -v node >/dev/null || echo "warning: node not found; agy-run needs it"
command -v agy  >/dev/null || echo "warning: agy not found; install Antigravity CLI: curl -fsSL https://antigravity.google/cli/install.sh | bash"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "warning: ~/.local/bin is not on your PATH";; esac
