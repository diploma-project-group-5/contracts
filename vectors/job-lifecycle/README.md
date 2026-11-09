# Сценарії життєвого циклу задачі (job)

Поведінковий контракт між `solver` і `timetable-service` (спека, розділи 05 і 12). `solver` комітить offset **до** розрахунку, тож `timetable` має
витримувати всі послідовності подій нижче. Кожен файл — один сценарій, який `timetable` проганяє
у своїх тестах проти власної машини станів задачі.

## Формат

```json
{
  "name": "…",
  "description": "…",
  "job": { "job_id": "…", "created_at": "…", "queue_deadline_at": "…", "time_limit_s": 60 },
  "run_deadline_margin_s": 90,
  "steps": [
    { "event": { "type": "solve.started",   "event_id": "…", "data": { "job_id": "…", "started_at": "…" } } },
    { "event": { "type": "solve.completed", "event_id": "…", "data": { "job_id": "…", "status": "FEASIBLE" } } },
    { "watchdog_at": "…" }
  ],
  "expected": { "state": "done", "ignored_steps": [] }
}
```

- `event` — подія з топіка `solve.status` (у `data` наведено лише поля, важливі для сценарію).
- `watchdog_at` — прогін сторожа в цей момент. Сторож закриває як `failed`:
  - задачу в `queued` після `queue_deadline_at`;
  - задачу в `running` після `run_deadline_at = started_at + time_limit_s + run_deadline_margin_s`.
- `expected.state` — стан задачі після всіх кроків.
- `expected.ignored_steps` — індекси кроків (від 0), які `timetable` має проігнорувати без зміни стану.

## Правила, які перевіряють сценарії

| Подія / прогін | Приймається, якщо стан | Перехід |
| --- | --- | --- |
| `solve.started` | `queued` | → `running` (записати `started_at`, `run_deadline_at`) |
| `solve.completed` | `queued` або `running` (будь-який некінцевий) | за статусом: OPTIMAL/FEASIBLE → `done`*, INFEASIBLE → `infeasible`, UNKNOWN → `timeout`, MODEL_INVALID → `failed`, EXPIRED → `failed` |
| будь-яка подія | кінцевий стан (`done`, `infeasible`, `rejected`, `timeout`, `failed`) | ігнорується |
| повтор того самого `event_id` | будь-який | ігнорується (inbox) |
| сторож | `queued` після `queue_deadline_at` або `running` після `run_deadline_at` | → `failed` |

\* `done`, якщо `validator-lib` прийняв розв'язок; інакше `rejected`. У сценаріях вважаємо, що
розв'язок валідний: перевірку validator-lib ці сценарії не тестують.
