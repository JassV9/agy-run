#!/usr/bin/env bash
# Tag the current commit with the plugin version and publish a GitHub release
# that includes a zip of the skill folder for uploading to claude.ai.
# Usage: ./release.sh            (run after committing and pushing your changes)
set -euo pipefail
cd "$(dirname "$0")"

V=$(node -p 'require("./.claude-plugin/plugin.json").version')
MV=$(node -p 'require("./.claude-plugin/marketplace.json").plugins[0].version')
[ "$V" = "$MV" ] || { echo "version mismatch: plugin.json=$V marketplace.json=$MV" >&2; exit 1; }
SV=$(sed -n "s/^export const VERSION = '\\(.*\\)';/\\1/p" skills/gemini-neon-subagent/scripts/common.mjs)
[ "$V" = "$SV" ] || { echo "version mismatch: plugin.json=$V scripts/common.mjs=$SV" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "working tree not clean; commit first" >&2; exit 1; }
git rev-parse -q --verify "refs/tags/v$V" >/dev/null && { echo "tag v$V already exists; bump the version" >&2; exit 1; }

claude plugin validate . >/dev/null

mkdir -p dist
ZIP="dist/gemini-neon-subagent-$V.zip"
rm -f "$ZIP"
(cd skills && python3 -m zipfile -c "../$ZIP" gemini-neon-subagent)

NOTES=$(awk -v v="$V" '$0 ~ "^## "v {f=1; next} /^## / && f {exit} f' CHANGELOG.md)
git tag -a "v$V" -m "v$V"
git push origin "v$V"
gh release create "v$V" "$ZIP" --title "v$V" --notes "${NOTES:-Release v$V}"
echo "Released v$V"
