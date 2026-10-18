#!/usr/bin/env bash
# Остановить прогоны vitest, не задев свою оболочку: bash .claude/skills/test-triage/scripts/stop-vitest.sh [фильтр]
#   без фильтра — все vitest на машине (и долгие замеры world-audit тоже!);
#   с фильтром — только те, чья команда содержит фильтр (например «tests/dugout» или «density»), вместе с их
#   дочерними процессами (воркеры vitest — отдельные node-процессы без имени теста в команде).
# Зачем: `pkill -f vitest` в той же команде убивает и саму оболочку — её строка тоже содержит «vitest» (выход 144).
FILTER="${1:-}"
# Свои предки (оболочка, из которой запущен скрипт) — не трогать.
declare -A mine
p=$$
while [ -n "$p" ] && [ "$p" != "0" ]; do
  mine[$p]=1
  p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
done
table=$(ps -eo pid=,ppid=,args=)
# Корни: с фильтром — процессы, в команде которых он есть (и `npm test`, где слова vitest нет); без — все vitest.
roots=$(echo "$table" | awk -v f="$FILTER" '!/stop-vitest/ && ((f == "" && /vitest/) || (f != "" && index($0, f) > 0)) { print $1 }')
kill_list=""
for r in $roots; do
  [ -n "${mine[$r]:-}" ] && continue
  kill_list="$kill_list $r"
done
# Потомки выбранных (воркеры).
frontier="$kill_list"
while [ -n "$frontier" ]; do
  next=""
  for p in $frontier; do
    kids=$(echo "$table" | awk -v pp="$p" '$2 == pp { print $1 }')
    for k in $kids; do
      [ -n "${mine[$k]:-}" ] && continue
      case " $kill_list " in *" $k "*) ;; *) kill_list="$kill_list $k"; next="$next $k" ;; esac
    done
  done
  frontier="$next"
done
if [ -z "${kill_list// /}" ]; then
  echo "vitest${FILTER:+ с «$FILTER»} не запущен"
  exit 0
fi
kill $kill_list 2>/dev/null || true
sleep 1
for p in $kill_list; do kill -9 "$p" 2>/dev/null || true; done
echo "остановлено: $(echo $kill_list | wc -w) процессов${FILTER:+ (фильтр «$FILTER»)}"
