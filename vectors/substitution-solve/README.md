# Вектори рушія замін (`substitution-solve`, contracts 0.5.0)

Спільна істина для рушія замін у `solver` (кроки 1–3) і для тих, хто перевіряє його відповідь
(`timetable-service`, bench). Рішення — ADR `2026-11-15-solver-substitution-engine`; спека, розділ 06
«Відсутність вчителя → заміна».

Вектор описує **властивості** відповіді, а не точний вихід: рушій може обрати будь-який з однаково добрих
варіантів, тож вектор фіксує лише те, що з правил випливає однозначно.

Файли генерує `node scripts/gen-substitution-solve-vectors.mjs vectors/substitution-solve`. Очікування в
генераторі записано вручну; генератор лише будує базовий заклад і рахує `rows` з шаблону, щоб у вихідному
тижні не було конфліктів плану. Після змін — переглянути diff векторів.

## Формат

```json
{
  "name": "05-step3-neighbour-date",
  "description": "…",
  "params": {
    "works_that_day": "has_lesson_that_day",
    "off_profile": "no_row_with_subject",
    "equal_distance": "later_date",
    "step2_scope": "per_lesson",
    "self_study_step": "last_step_that_ran"
  },
  "given": { "request": { /* data події solve.substitution.requested, проходить її схему */ } },
  "expect": {
    "status_in": ["OPTIMAL", "FEASIBLE"],
    "step": 3,
    "never_teachers": ["t-1", "t-3"],
    "never_dates": ["2026-11-19"],
    "extra_rows": [],
    "lessons": [
      { "class_id": "c-1", "lesson_no": 1, "kind": "teacher", "teacher_id": "t-4", "off_profile": false, "step": 1 },
      { "class_id": "c-2", "lesson_no": 2, "kind": "moved",
        "moved_to": { "date": "2026-11-18", "lesson_no_in": [4, 5, 6] }, "step": 3 },
      { "class_id": "c-2", "lesson_no": 5, "kind": "self_study", "step": 3 }
    ]
  },
  "alternatives": [
    { "params": { "equal_distance": "earlier_date" }, "given_patch": {}, "stage": "after_defence",
      "note": "…", "expect": { /* те саме, що expect */ } }
  ]
}
```

- `given.request` — повне `data` запиту. Відповідь рушія — `data.substitution` події `solve.completed`.
- `expect.status_in` — допустимі статуси (лише OPTIMAL або FEASIBLE: розв'язок є завжди).
- `expect.step` — очікуване `substitution.step`.
- `expect.lessons` — по одному запису на кожен урок `request.lessons`:
  - `kind` — точний вид пропозиції, або `kind_in` — множина допустимих;
  - `teacher_id` — точний замісник, або `teacher_id_in` — допустимі замісники;
  - `off_profile` — очікуване значення для `kind=teacher`;
  - `moved_to.date` — точна дата; `moved_to.lesson_no_in` — допустимі номери уроку;
  - `step` — очікуване `proposal.step`.
- `expect.never_teachers` — ці вчителі не з'являються як `teacher_id` у жодній пропозиції.
- `expect.never_dates` — ці дати не з'являються в жодному `moved_to.date`.
- `expect.extra_rows: []` — рядків поза `request.lessons` немає. `extra_rows_allowed: true` (лише в
  `alternatives` з `allow_support_moves=true`) — рядки поза `lessons` дозволені, але лише `kind=moved`.
- `alternatives[]` — той самий вхід з іншим тлумаченням (`params` перекриває поля верхнього рівня) або
  з латкою запиту (`given_patch` зливається з `given.request`). `stage: "after_defence"` — очікування для
  функції після захисту (ланцюги перестановок), поки що не нормативне.

## Інваріанти для кожного вектора

Їх перевіряє кожен споживач, навіть якщо в `expect` їх не названо:

1. Відповідь проходить схему `solve.status.v1.json` (`completed` з `substitution`; `lessons`, `day_formats`,
   `conflicts` порожні).
2. Кожен урок `request.lessons` трапляється рівно раз, з `date = request.date`.
3. `kind` ∈ {`teacher`, `moved`, `self_study`}; `cancelled` обирає лише людина.
4. `substitution.step = max(proposals[].step)`.
5. Тиждень із накладками (baseline + пропозиції) не має нових конфліктів:
   `lad-validate --mode new-conflicts` дає `added == []` (CLI — validator-lib 0.4.0).
6. Вихід детермінований: той самий запит дає байт-у-байт ту саму відповідь.

## Тлумачення (`params`)

| Поле | Значення у векторах | Що означає | Альтернатива |
| --- | --- | --- | --- |
| `works_that_day` | `has_lesson_that_day` | кандидат кроку 1 має щонайменше один урок цього дня (рішення Романа, 15.11.2026) | `any_available_teacher` (вектор 10) |
| `off_profile` | `no_row_with_subject` | «не за фахом» = у замісника немає рядка плану з предметом уроку в жодному класі | — |
| `equal_distance` | `later_date` | на кроці 3 за рівної відстані від дати першою пробується пізніша (рішення Романа) | `earlier_date` (вектор 17) |
| `step2_scope` | `per_lesson` | крок 2 бере лише уроки, які крок 1 не покрив; пропозиції кроку 1 закріплено | — |
| `self_study_step` | `last_step_that_ran` | `step` для `self_study`: 3, якщо в запиті є `non_school_dates` (крок 3 увімкнено), інакше 2 | — |

## Базовий заклад

ISO-тиждень 2026-W47 (пн 16.11 – пт 20.11), 5 навчальних днів, 6 уроків, модель 1.1, паспорт 200 (місткість
у цих векторах не обмежує). Класи c-1, c-2, c-3. Відсутній — t-1 (математика): щодня c-1 L1 і c-2 L2.

- Пн, ср, чт, пт: c-1 — math t-1, ukr t-2, art t-5; c-2 — ukr t-2, math t-1, eng t-3; c-3 — eng t-3, math t-4, ukr t-2.
- Вт: c-1 — math t-1, ukr t-2, eng t-3; c-2 — ukr t-2, math t-1, phys t-4; c-3 — eng t-3, math t-4, ukr t-2.
  У L1 вільний лише t-4 (математик), у L2 — лише t-3 (англійська); t-5 у вівторок уроків не має.
- Вільні слоти класів: L4–L6 кожного дня. «Вичерпаний ліміт» (`exhaust` у генераторі) — тижневий ліміт
  дорівнює навантаженню без неробочих дат, з погодженими замінами.

## Сценарії

| Файл | Що перевіряє |
| --- | --- |
| 01-step1-free-teacher | крок 1: єдиний вільний кандидат; за фахом і «не за фахом» |
| 02-step1-prefers-on-profile | ціль кроку 1: «за фахом» краще за «не за фахом» |
| 03-step2-move-within-day | крок 2: перенос у межах дня, коли вчитель присутній (часткова відсутність) |
| 04-step2-only-for-uncovered-lessons | кроки послідовні й поурочні: крок 2 лише для непокритого уроку |
| 05-step3-neighbour-date | крок 3: найближча дата вікна, далі не йде |
| 06-self-study-when-nothing-fits | нічого не підходить — усе `self_study`, `cancelled` не пропонується |
| 07-forbidden-substitute-absent | заборонений: замісник відсутній саме в цей урок (`absences[]`, `lesson_nos`) |
| 08-forbidden-unavailable-day | заборонений: недоступний день (застарілий знімок, власні уроки лишаються) |
| 09-forbidden-weekly-limit-exhausted | заборонений: ліміт вичерпано з урахуванням погодженої заміни тижня |
| 10-forbidden-no-lessons-that-day | заборонений: вчитель без уроків цього дня; альтернатива `any_available_teacher` |
| 11-forbidden-mixed-format | заборонений: вчитель дистанційного дня в очний клас |
| 12-no-move-into-slot-freed-by-same-job | без `allow_support_moves` — жодного переносу в слот, звільнений іншою пропозицією задачі; альтернатива з прапорцем (після захисту) |
| 13-baseline-week-with-overlays | baseline з накладками всіх видів і застарілим конфліктом — розв'язок усе одно є |
| 14-step3-iso-week-border | вікно не виходить за ISO-тиждень (пн 23.11 — ні) |
| 15-step3-not-before | вікно не раніше `not_before` |
| 16-step3-non-school-dates | неробоча дата не входить у вікно |
| 17-step3-equal-distance-later-date | рівна відстань — пізніша дата; альтернатива `earlier_date` |
| 18-step3-skips-dates-of-the-same-absence | дата, на яку вчитель теж відсутній, пропускається |

Не покрито (наступні вектори): шаблон тривог (модель 1.2, `seats`, «не в укритті» на кроці 3), місткість
нового очного вчителя (з рішенням `has_lesson_that_day` новий очний вчитель на кроці 1 неможливий),
ланцюги перестановок з нормативним очікуванням.
