#!/usr/bin/env bash
# Рабочая копия старой версии кода для замера «до»: bash .claude/skills/world-audit/scripts/baseline.sh <коммит|ветка> [каталог]
# Создаёт отсоединённый git worktree (по умолчанию /tmp/hl2d-base-<ref>), подключает node_modules текущей копии ссылкой и
# кладёт туда скрипты замеров этого скилла (в старом коде их может не быть). Печатает путь — запускай замер оттуда:
#   cd <путь> && TAG=before npx vitest run --config .claude/skills/world-audit/scripts/vitest.config.mjs density
# Удалить: git worktree remove --force <путь>
set -euo pipefail
REF="${1:?нужен коммит или ветка, например HEAD~1}"
ROOT="$(git rev-parse --show-toplevel)"
SAFE="$(echo "$REF" | tr '/~^:' '____')"
DIR="${2:-/tmp/hl2d-base-$SAFE}"
cd "$ROOT"
if [ ! -d "$DIR" ]; then
  git worktree add --detach "$DIR" "$REF" >/dev/null
fi
ln -sfn "$ROOT/node_modules" "$DIR/node_modules"
mkdir -p "$DIR/.claude/skills/world-audit/scripts"
cp "$ROOT"/.claude/skills/world-audit/scripts/* "$DIR/.claude/skills/world-audit/scripts/"
echo "$DIR"
