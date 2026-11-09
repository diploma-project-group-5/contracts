# contracts — «Лад»

> **Статус: DRAFT by osovyk for review; owner TBD.** Чернетка схем подій `solve.*`, маніфесту топіків
> і сценаріїв задачі для узгодження з власником `contracts`. Пакетів npm/pip ще немає.
> Рішення й обґрунтування — в описі PR, який додав ці файли (картка Trello #23).

## Що тут

```text
schemas/events/
  defs.v1.json                          спільні $defs: id, day, lesson, day_format, capacity, …
  envelope.v1.json                      конверт: event_id, type, schema_version, source, time,
                                        correlation_id, school_id, data
  conflict.v1.json                      форма конфлікту {rule, class_id?, teacher_id?, subject_id?,
                                        day?, condition?, hint?} з enum rule
  solve.build.requested.v1.json         timetable → solver (етап 1)
  solve.status.v1.json                  solver → timetable: oneOf solve.started | solve.completed
                                        за полем конверта `type`
  solve.substitution.requested.v1.json  ЕТАП 2, ЧЕРНЕТКА — не реалізовувати до етапу 2
examples/<schema-stem>/*.json           приклади; кожен має проходити свою схему
vectors/capacity/*.json                 спільні тест-вектори формули місткості (1.1 і 1.2)
vectors/job-lifecycle/*.json            сценарії життєвого циклу задачі: послідовність подій
                                        solve.status і прогонів сторожа → очікуваний стан задачі
topics.v1.json                          маніфест топіків: продюсер, консюмери, ключ, партиції,
                                        зберігання, DLQ; без .retry.*
```

### Маніфест топіків і сценарії задачі

- `platform/kafka-init` створює топіки **з `topics.v1.json`**, а не зі списку в картці: кожен топік,
  а до кожного топіка, який хтось споживає, — `<топік>.dlq` (зберігання 14 днів). Топіків `.retry.*`
  немає: технічна помилка — 3 спроби в консюмері, далі DLQ (спека, розділ 12).
- Продюсери й консюмери перевіряють у своїх тестах, що працюють лише з топіками маніфесту у своїй
  ролі (у solver — `tests/adapters/test_topics_and_lifecycle.py`).
- `timetable-service` проганяє `vectors/job-lifecycle/*.json` проти своєї машини станів задачі.
  solver комітить offset **до** розрахунку, тож timetable має витримувати completed без started,
  дублі, пізні події після сторожа й мовчання після падіння solver (опис формату — у README каталогу).

Схеми — JSON Schema draft 2020-12, посилаються одна на одну відносним `$ref`
(`defs.v1.json#/$defs/…`) у межах базового `$id` `https://lad.example/contracts/schemas/events/`.
Валідатору треба завантажити всі файли каталогу в реєстр за їхнім `$id`.

`additionalProperties: false` стоїть свідомо: схема документує точну форму, а тест продюсера ловить
зайві поля. Насамперед це підписи вчителів чи назви класів у `solve.*`. Консюмери при цьому
**толерантні**: невідомі поля ігнорують (pydantic `extra='ignore'` у solver), тож мінорне
додавання поля їх не ламає.

## Версіонування

- `schema_version` у конверті — `MAJOR.MINOR`, зараз `"1.0"`.
- Додавання опційного поля чи значення enum — MINOR. Файл `*.v1.json` оновлюється на місці,
  версія пакета піднімається як minor.
- Ламаюча зміна — новий MAJOR: новий файл `*.v2.json` і `schema_version: "2.0"`. Консюмер, що бачить
  невідомий MAJOR, відхиляє подію. solver відповідає `solve.completed{MODEL_INVALID,
  error.code=unsupported_schema_version}`.
- Пакети npm і pip матимуть одну semver-версію. Сервіси закріплюють її точно (`0.3.1`, не `^0.3.1`).

## Відхилення від спеки v24, які закодовано тут

Обґрунтування кожного — в описі PR, який додав ці файли.

1. **Payload `solve.build.requested`.** Додано `lessons_per_day` і `school_days`: для `kind=alert`
   їх рахує timetable за дзвінками тривог. Знімок — проєкція лише з id: без назв класів і **без
   підписів учителів** (мінімізація ПД, ст. 6 Закону № 2297-VI). Модель — рядок `"1.1"` / `"1.2"`,
   і вона узгоджена з `kind` через `if/then`.
2. **Результат.** `lessons[]{class_id, day, lesson_no, subject_id, teacher_id}`, `day_formats[]` і
   опційні `stats` (objective, best_bound, wall_time_ms, версії, `input_sha256`, `stop_reason`,
   `quality_relaxed`).
3. **Форма конфлікту.** `conflict.v1.json` має один enum `rule` для solver і validator-lib.
   validator-lib додасть свої коди як MINOR.
4. **Детерміновані помилки.** Вони не повторюються: `solve.completed{MODEL_INVALID, error.code ∈
   {invalid_payload, unsupported_schema_version, result_too_large, internal}}`. Нового статусу немає.
   Поле `error` дозволене лише з `MODEL_INVALID`.
5. **Ліміт часу.** `time_limit_s` — верхня межа всієї обробки в solver; solver обрізає значення до [10, 180] с
   і може завершити раніше, коли ціль перестала покращуватись (`stats.stop_reason = no_improvement`).
   `queue_deadline_at` ≥ створення + 10 хв. Після нього solver відповідає `EXPIRED` без `solve.started`.
6. **Етап 2.** У чернетку `solve.substitution.requested` додано `not_before` (дата Europe/Kyiv).

## Хто як використовує

- **solver** (Python, власник osovyk) читає `solve.build.requested` і пише `solve.status`.
  Поки пакета pip немає, pydantic-моделі в `solver/src/lad_solver/adapters/kafka/payload.py` написано
  вручну за цими схемами. Тест `solver/tests/adapters/test_contracts.py` перевіряє вихідні події й
  `examples/` цими схемами; каталог береться з `LAD_CONTRACTS_DIR`, за замовчуванням `../contracts`.
- **timetable-service** (TS) публікує `solve.build.requested` через outbox, споживає `solve.status`
  (inbox за `event_id`) і показує `conflicts[]`. Типи генерує з цих схем.
- **validator-lib** (TS) використовує `conflict.v1.json` для `conflicts[]` і проганяє
  `vectors/capacity/*` у своїх тестах.

## Вектори місткості

Кожен файл описує один навчальний день і очікуваний вердикт для кожної умови.

```json
{
  "model": "1.1" | "1.2",
  "staff": 5,
  "capacity": {"passport": 62} | {"seats": 55, "passport": 62},
  "day": {
    "classes": [{"id", "students", "in_person"}],
    "lessons": [{"class_id", "teacher_id"}]
  },
  "expected": {
    "students_in_person": 55,
    "teachers_on_site": 2,
    "conditions": {"passport": {"load", "limit", "ok"}, "seats": {...}},
    "ok": true
  }
}
```

Правила, які покривають вектори:

- учитель «на місці», якщо в нього є хоча б один урок в очному класі цього дня. Скільки б таких уроків
  не було, він рахується один раз;
- учні дистанційних класів не рахуються;
- `seats` — лише учні, і ця умова є тільки в моделі 1.2;
- `passport` — учні, непедагогічний персонал і вчителі на місці;
- для кожної умови є випадок «рівно на ліміті — проходить» і «+1 — порушення»;
- окремо є пара 1.1 проти 1.2 на тому самому дні.

Вектори в solver і validator-lib мають давати однаковий вердикт.

## Вектори замін (етап 2, contracts 0.3.0)

`vectors/substitution/*.json` — спільна істина для `validator-lib` (вердикт) і `timetable-service` (функція
`effectiveWeek`, яка збирає тиждень із накладками). ADR `2026-11-09-validator-lib-substitution-check`.

```json
{
  "description": "…",
  "given": {
    "snapshot": {…}, "template": {"lessons": […], "day_formats": […]},
    "holidays": [3], "absences": [{"teacher_id", "day", "lesson_nos"}],
    "overlays": [{"day", "class_id", "lesson_no", "kind": "teacher|moved|self_study|cancelled",
                  "new_teacher_id"?, "moved_to"?: {"day", "lesson_no"}}]
  },
  "input": { /* validation.input.v1: тиждень, який має зібрати effectiveWeek(given) */ },
  "expected": {"status": "ACCEPTED|REJECTED", "conflicts": […]} | {"status": "INVALID_INPUT", "issue_codes": […]}
}
```

- Дні — дні тижня 1..6 (вектори без дат); `timetable` перетворює дату на день тижня в межах одного ISO-тижня.
- Свята спершу прибирають уроки шаблону (`not_held{kind: "holiday"}`) і день із `school_days`, потім застосовуються накладки.
- Вектори без `given` — помилки складання тижня чи входу: їх ловить лише бібліотека.
- Генератор: `node scripts/gen-substitution-vectors.mjs vectors/substitution` (вердикти в ньому записано вручну; після змін — переглянути diff векторів).
- `vectors/substitution-approve/*.json`: `{description, baseline, effective, expected: {added}}` для `newConflicts` на
  `:approve` (що заміна додала чи погіршила; полегшення наявного конфлікту — не нове).
- `validation.input.v1` у 0.3.0: `lessons[].origin`, `timetable.not_held[]`, `absences[]`, `holidays[]` (усі
  необов'язкові); `validation.outcome.v1`: коди issue `requires_absences`, `requires_holidays`, `not_held_day`,
  `duplicate_slot`.
