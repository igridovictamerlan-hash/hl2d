#!/usr/bin/env bash
# Сводка упавших тестов из лога vitest: bash .claude/skills/test-triage/scripts/failures.sh <лог>
# Для каждого падения — файл и имя теста, сообщение (AssertionError/Error) и строка в тесте; в конце — итог прогона.
set -euo pipefail
LOG="${1:?нужен путь к логу vitest}"
if ! grep -q "Test Files" "$LOG"; then
  echo "прогон ещё идёт или оборван (нет строки «Test Files»)"
fi
awk '
  / FAIL  / { if (name != "") print_one(); name = $0; sub(/^.*FAIL  +/, "", name); msg = ""; loc = ""; next }
  name != "" && msg == "" && /(AssertionError|Error|expected )/ { msg = $0; sub(/^ +/, "", msg); next }
  name != "" && loc == "" && / ❯ tests\// { loc = $0; sub(/^.*❯ /, "", loc); next }
  function print_one() { printf("✗ %s\n    %s\n    %s\n", name, msg, loc); name = "" }
  END { if (name != "") print_one() }
' "$LOG" | awk '!seen[$0]++'
grep -E "^ +(Test Files|Tests) " "$LOG" || true
