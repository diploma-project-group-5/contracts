// Builds vectors/substitution/*.json and vectors/substitution-approve/*.json: node scripts/gen-substitution-vectors.mjs vectors/substitution
// Every vector states its expected verdict by hand; the generator only spares copy-paste of the base school.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const clone = (x) => JSON.parse(JSON.stringify(x));
const L = (class_id, day, lesson_no, subject_id, teacher_id) => ({ class_id, day, lesson_no, subject_id, teacher_id });

const baseSnapshot = () => ({
  kind: 'main',
  school_days: [1, 2, 3, 4, 5],
  lessons_per_day: 6,
  staff: 2,
  capacity: { passport: 60 },
  classes: [
    { id: 'c-1', students: 20, priority: true },
    { id: 'c-2', students: 20, priority: false },
  ],
  subjects: [
    { id: 's-math', priority_area: true, no_shelter: false },
    { id: 's-ukr', priority_area: false, no_shelter: false },
    { id: 's-pe', priority_area: false, no_shelter: true },
  ],
  teachers: [
    { id: 't-1', weekly_limit: 6, unavailable_days: [] },
    { id: 't-2', weekly_limit: 10, unavailable_days: [] },
    { id: 't-3', weekly_limit: 4, unavailable_days: [2] },
    { id: 't-4', weekly_limit: 2, unavailable_days: [] },
  ],
  rows: [
    { class_id: 'c-1', subject_id: 's-math', teacher_id: 't-1', hours: 3 },
    { class_id: 'c-1', subject_id: 's-ukr', teacher_id: 't-2', hours: 3 },
    { class_id: 'c-2', subject_id: 's-math', teacher_id: 't-1', hours: 3 },
    { class_id: 'c-2', subject_id: 's-ukr', teacher_id: 't-2', hours: 2 },
    { class_id: 'c-2', subject_id: 's-pe', teacher_id: 't-3', hours: 2 },
  ],
});

const baseTemplate = () => ({
  lessons: [
    L('c-1', 1, 1, 's-math', 't-1'), L('c-1', 1, 2, 's-ukr', 't-2'),
    L('c-1', 2, 1, 's-math', 't-1'), L('c-1', 2, 2, 's-ukr', 't-2'),
    L('c-1', 3, 1, 's-math', 't-1'),
    L('c-1', 4, 2, 's-ukr', 't-2'), // remote day
    L('c-2', 1, 3, 's-math', 't-1'), L('c-2', 1, 4, 's-ukr', 't-2'),
    L('c-2', 2, 2, 's-math', 't-1'),
    L('c-2', 3, 3, 's-math', 't-1'), L('c-2', 3, 4, 's-ukr', 't-2'),
    L('c-2', 4, 1, 's-pe', 't-3'), L('c-2', 4, 2, 's-pe', 't-3'),
  ],
  day_formats: [
    ...[1, 2, 3, 4, 5].map((day) => ({ class_id: 'c-1', day, in_person: day <= 3 })),
    ...[1, 2, 3, 4, 5].map((day) => ({ class_id: 'c-2', day, in_person: day <= 4 })),
  ],
});

/**
 * Materialises the effective week for a fixture. Overlay kinds: teacher (new_teacher_id), moved (moved_to),
 * self_study, cancelled. This mirrors the ADR semantics only to build fixtures; each expected verdict is hand-checked.
 */
function effective({ snapshot, template, holidays = [], absences = [], overlays = [] }) {
  const slot = (o) => (l) => l.class_id === o.class_id && l.day === o.day && l.lesson_no === o.lesson_no;
  let lessons = clone(template.lessons);
  const not_held = [];
  // Holidays first: they remove template lessons; an overlay may still move a lesson onto a holiday (rule 4).
  for (const d of holidays) {
    for (const l of lessons.filter((x) => x.day === d)) {
      not_held.push({ class_id: l.class_id, day: l.day, lesson_no: l.lesson_no, subject_id: l.subject_id, kind: 'holiday' });
    }
    lessons = lessons.filter((x) => x.day !== d);
  }
  for (const o of overlays) {
    const i = lessons.findIndex(slot(o));
    if (i < 0) throw new Error(`overlay on an empty slot: ${JSON.stringify(o)}`);
    const l = lessons[i];
    if (o.kind === 'teacher') lessons[i] = { ...l, teacher_id: o.new_teacher_id, origin: 'substitution' };
    if (o.kind === 'moved') lessons[i] = { ...l, day: o.moved_to.day, lesson_no: o.moved_to.lesson_no };
    if (o.kind === 'self_study' || o.kind === 'cancelled') {
      lessons.splice(i, 1);
      not_held.push({ class_id: l.class_id, day: l.day, lesson_no: l.lesson_no, subject_id: l.subject_id, kind: o.kind });
    }
  }
  const snap = clone(snapshot);
  snap.school_days = snap.school_days.filter((d) => !holidays.includes(d));
  const timetable = {
    lessons,
    day_formats: template.day_formats.filter((f) => !holidays.includes(f.day)),
    ...(not_held.length > 0 ? { not_held } : {}),
  };
  return {
    schema_version: '1.0',
    snapshot: snap,
    timetable,
    ...(absences.length > 0 ? { absences } : {}),
    ...(holidays.length > 0 ? { holidays } : {}),
  };
}

const vectors = [];
function vector(name, description, given, expected, mutate) {
  const g = { snapshot: baseSnapshot(), template: baseTemplate(), holidays: [], absences: [], overlays: [], ...given };
  const input = effective(g);
  if (mutate) mutate(input);
  vectors.push({ name, body: { description, ...(mutate ? {} : { given: g }), input, expected } });
}
const A = (teacher_id, day, lesson_nos) => ({ teacher_id, day, lesson_nos });
const ok = { status: 'ACCEPTED', conflicts: [] };
const rejected = (...conflicts) => ({ status: 'REJECTED', conflicts });
const invalid = (...issue_codes) => ({ status: 'INVALID_INPUT', issue_codes });
const withSnapshot = (f) => { const s = baseSnapshot(); f(s); return s; };

vector('00-base-week', 'Base school without substitutions: the template itself is valid', {}, ok);
vector('01-teacher-off-profile', 'Substitute from outside the plan ("не за фахом") is exempt from teacher_not_in_plan',
  { absences: [A('t-2', 2, [2])], overlays: [{ day: 2, class_id: 'c-1', lesson_no: 2, kind: 'teacher', new_teacher_id: 't-4' }] }, ok);
vector('02-substitute-double-booked', 'Substitute already teaches another class in that slot',
  { snapshot: withSnapshot((s) => { s.teachers[0].weekly_limit = 10; }),
    absences: [A('t-2', 2, [2])], overlays: [{ day: 2, class_id: 'c-1', lesson_no: 2, kind: 'teacher', new_teacher_id: 't-1' }] },
  rejected({ rule: 'teacher_double_booked', teacher_id: 't-1', day: 2, lesson_no: 2 }));
vector('03-substitute-unavailable-weekday', 'Substitute is unavailable on that weekday (snapshot unavailable_days)',
  { absences: [A('t-2', 2, [2])], overlays: [{ day: 2, class_id: 'c-1', lesson_no: 2, kind: 'teacher', new_teacher_id: 't-3' }] },
  rejected({ rule: 'teacher_unavailable_day', teacher_id: 't-3', day: 2 }));
vector('04-substitute-also-absent', 'Substitute is absent himself on that lesson of the date',
  { absences: [A('t-2', 2, [2]), A('t-4', 2, [1, 2])], overlays: [{ day: 2, class_id: 'c-1', lesson_no: 2, kind: 'teacher', new_teacher_id: 't-4' }] },
  rejected({ rule: 'teacher_unavailable_day', teacher_id: 't-4', day: 2, lesson_no: 2 }));
vector('05-substitute-mixed-format', 'Substitute teaches a remote lesson that day and is put into an in-person class',
  { absences: [A('t-3', 4, [1])], overlays: [{ day: 4, class_id: 'c-2', lesson_no: 1, kind: 'teacher', new_teacher_id: 't-2' }] },
  rejected({ rule: 'teacher_mixed_format', teacher_id: 't-2', day: 4 }));
vector('06-substitute-weekly-limit', 'Three substitutions push the substitute over the weekly limit',
  { absences: [A('t-2', 1, [2, 4]), A('t-2', 2, [2])],
    overlays: [
      { day: 1, class_id: 'c-1', lesson_no: 2, kind: 'teacher', new_teacher_id: 't-4' },
      { day: 1, class_id: 'c-2', lesson_no: 4, kind: 'teacher', new_teacher_id: 't-4' },
      { day: 2, class_id: 'c-1', lesson_no: 2, kind: 'teacher', new_teacher_id: 't-4' },
    ] },
  rejected({ rule: 'teacher_weekly_limit', teacher_id: 't-4', value: 3, limit: 2 }));
vector('07-weekly-limit-counts-lost-lessons', 'Lessons the teacher lost this week free his weekly limit (6 - 2 + 1 = 5 <= 6)',
  { absences: [A('t-1', 1, [1, 3]), A('t-2', 3, [4])],
    overlays: [
      { day: 1, class_id: 'c-1', lesson_no: 1, kind: 'self_study' },
      { day: 1, class_id: 'c-2', lesson_no: 3, kind: 'self_study' },
      { day: 3, class_id: 'c-2', lesson_no: 4, kind: 'teacher', new_teacher_id: 't-1' },
    ] }, ok);
vector('08-moved-ok', 'A lesson moved to a free slot of another day of the week',
  { absences: [A('t-1', 1, [1, 3])],
    overlays: [
      { day: 1, class_id: 'c-1', lesson_no: 1, kind: 'moved', moved_to: { day: 3, lesson_no: 4 } },
      { day: 1, class_id: 'c-2', lesson_no: 3, kind: 'self_study' },
    ] }, ok);
vector('09-moved-into-busy-class-slot', 'A lesson moved into a slot where the class already has a lesson',
  { absences: [A('t-1', 1, [1, 3])],
    overlays: [
      { day: 1, class_id: 'c-1', lesson_no: 1, kind: 'moved', moved_to: { day: 4, lesson_no: 2 } },
      { day: 1, class_id: 'c-2', lesson_no: 3, kind: 'self_study' },
    ] },
  rejected({ rule: 'class_double_booked', class_id: 'c-1', day: 4, lesson_no: 2 }));
vector('10-two-moves-same-target', 'Two lessons moved into one target slot; the moves also empty an in-person day',
  { absences: [A('t-1', 1, [1, 3]), A('t-2', 1, [2, 4])],
    overlays: [
      { day: 1, class_id: 'c-1', lesson_no: 1, kind: 'moved', moved_to: { day: 3, lesson_no: 5 } },
      { day: 1, class_id: 'c-1', lesson_no: 2, kind: 'moved', moved_to: { day: 3, lesson_no: 5 } },
      { day: 1, class_id: 'c-2', lesson_no: 3, kind: 'self_study' },
      { day: 1, class_id: 'c-2', lesson_no: 4, kind: 'self_study' },
    ] },
  rejected(
    { rule: 'in_person_without_lessons', class_id: 'c-1', day: 1 },
    { rule: 'class_double_booked', class_id: 'c-1', day: 3, lesson_no: 5 },
  ));
vector('11-moved-target-capacity', 'A moved lesson brings one more teacher to the target day (45 > 44); partial absence',
  { snapshot: withSnapshot((s) => { s.capacity = { passport: 44 }; }),
    absences: [A('t-3', 4, [1])],
    overlays: [{ day: 4, class_id: 'c-2', lesson_no: 1, kind: 'moved', moved_to: { day: 3, lesson_no: 5 } }] },
  rejected({ rule: 'capacity_exceeded', day: 3, condition: 'passport', value: 45, limit: 44 }));
vector('12-moved-into-cancelled-slot', 'A cancelled lesson frees its slot for a moved lesson',
  { absences: [A('t-1', 1, [1, 3]), A('t-2', 4, [2])],
    overlays: [
      { day: 4, class_id: 'c-1', lesson_no: 2, kind: 'cancelled' },
      { day: 1, class_id: 'c-1', lesson_no: 1, kind: 'moved', moved_to: { day: 4, lesson_no: 2 } },
      { day: 1, class_id: 'c-2', lesson_no: 3, kind: 'self_study' },
    ] }, ok);
vector('13-moved-into-self-study-slot', 'Self-study keeps the class in its slot: a lesson moved there is a double booking',
  { absences: [A('t-1', 1, [1, 3]), A('t-2', 4, [2])],
    overlays: [
      { day: 4, class_id: 'c-1', lesson_no: 2, kind: 'self_study' },
      { day: 1, class_id: 'c-1', lesson_no: 1, kind: 'moved', moved_to: { day: 4, lesson_no: 2 } },
      { day: 1, class_id: 'c-2', lesson_no: 3, kind: 'self_study' },
    ] },
  rejected({ rule: 'class_double_booked', class_id: 'c-1', day: 4, lesson_no: 2 }));
vector('14-self-study', 'Self-study keeps plan hours and the in-person day',
  { absences: [A('t-2', 1, [2, 4])],
    overlays: [
      { day: 1, class_id: 'c-1', lesson_no: 2, kind: 'self_study' },
      { day: 1, class_id: 'c-2', lesson_no: 4, kind: 'self_study' },
    ] }, ok);
vector('15-cancelled-whole-in-person-day', 'Cancelling every lesson of an in-person class-day is the scheduler\'s choice, not a conflict',
  { absences: [A('t-1', 3, [1, 3])],
    overlays: [
      { day: 3, class_id: 'c-1', lesson_no: 1, kind: 'cancelled' },
      { day: 3, class_id: 'c-2', lesson_no: 3, kind: 'cancelled' },
    ] }, ok);
vector('16-move-empties-in-person-day', 'Moving the only lesson away leaves an in-person class-day empty',
  { absences: [A('t-1', 3, [1, 3])],
    overlays: [
      { day: 3, class_id: 'c-1', lesson_no: 1, kind: 'moved', moved_to: { day: 2, lesson_no: 3 } },
      { day: 3, class_id: 'c-2', lesson_no: 3, kind: 'self_study' },
    ] },
  rejected({ rule: 'in_person_without_lessons', class_id: 'c-1', day: 3 }));
vector('17-lesson-lost-without-not-held', 'Materialisation bug: a lesson vanished without a not_held record',
  { absences: [A('t-2', 1, [2, 4])],
    overlays: [
      { day: 1, class_id: 'c-1', lesson_no: 2, kind: 'self_study' },
      { day: 1, class_id: 'c-2', lesson_no: 4, kind: 'self_study' },
    ] },
  rejected({ rule: 'plan_hours_mismatch', class_id: 'c-1', subject_id: 's-ukr', value: 2, limit: 3 }),
  (input) => { input.timetable.not_held = input.timetable.not_held.filter((n) => n.class_id !== 'c-1'); });
vector('18-holiday', 'A holiday weekday: removed from school_days, its lessons are not_held holiday; no absences needed',
  { holidays: [3] }, ok);
vector('19-moved-onto-holiday', 'A lesson moved onto a holiday weekday',
  { holidays: [3], absences: [A('t-1', 1, [1, 3])],
    overlays: [
      { day: 1, class_id: 'c-1', lesson_no: 1, kind: 'moved', moved_to: { day: 3, lesson_no: 4 } },
      { day: 1, class_id: 'c-2', lesson_no: 3, kind: 'self_study' },
    ] },
  rejected({ rule: 'day_not_school_day', class_id: 'c-1', day: 3 }));
vector('20-alert-no-shelter-moved-in-person', 'Model 1.2: a "not in the shelter" lesson moved into an in-person day',
  { snapshot: withSnapshot((s) => { s.kind = 'alert'; s.capacity = { seats: 40, passport: 60 }; }),
    template: (() => { const t = baseTemplate(); t.day_formats.find((f) => f.class_id === 'c-2' && f.day === 4).in_person = false; return t; })(),
    absences: [A('t-3', 4, [1])],
    overlays: [{ day: 4, class_id: 'c-2', lesson_no: 1, kind: 'moved', moved_to: { day: 3, lesson_no: 5 } }] },
  rejected({ rule: 'no_shelter_in_person', class_id: 'c-2', subject_id: 's-pe', day: 3 }));
vector('21-origin-without-absences', 'origin=substitution without absences is a caller bug',
  { absences: [A('t-2', 2, [2])], overlays: [{ day: 2, class_id: 'c-1', lesson_no: 2, kind: 'teacher', new_teacher_id: 't-4' }] },
  invalid('requires_absences'), (input) => { delete input.absences; });
vector('22-self-study-without-absences', 'self_study without absences is a caller bug',
  { absences: [A('t-2', 1, [2, 4])], overlays: [{ day: 1, class_id: 'c-1', lesson_no: 2, kind: 'self_study' }] },
  invalid('requires_absences'), (input) => { delete input.absences; });
vector('23-holiday-without-holidays', 'A holiday slot needs its weekday in holidays (else a Saturday could hide a lost lesson)',
  {}, invalid('requires_holidays'),
  (input) => { input.timetable.not_held = [{ class_id: 'c-1', day: 6, lesson_no: 5, subject_id: 's-math', kind: 'holiday' }]; });
vector('24-duplicate-not-held-slot', 'Two not_held records on one class slot are a caller bug',
  { absences: [A('t-2', 1, [2, 4])],
    overlays: [{ day: 1, class_id: 'c-1', lesson_no: 2, kind: 'self_study' }] },
  invalid('duplicate_slot'),
  (input) => { input.timetable.not_held.push({ ...input.timetable.not_held[0], kind: 'cancelled' }); });


const T = (day, class_id, lesson_no, new_teacher_id) => ({ day, class_id, lesson_no, kind: 'teacher', new_teacher_id });
const M = (day, class_id, lesson_no, to_day, to_no) => ({ day, class_id, lesson_no, kind: 'moved', moved_to: { day: to_day, lesson_no: to_no } });
const S = (day, class_id, lesson_no, kind = 'self_study') => ({ day, class_id, lesson_no, kind });
const alertTemplate = () => { const t = baseTemplate(); t.day_formats.find((f) => f.class_id === 'c-2' && f.day === 4).in_person = false; return t; };

vector('25-substitute-without-plan-teacher-absent', 'origin=substitution where the plan teacher is not absent in that slot (an absence elsewhere does not count)',
  { absences: [A('t-1', 5, [1])], overlays: [T(2, 'c-1', 2, 't-4')] }, invalid('requires_absences'));
vector('26-self-study-without-plan-teacher-absent', 'self_study where the plan teacher is not absent in that slot',
  { absences: [A('t-1', 5, [1])], overlays: [S(1, 'c-1', 2)] }, invalid('requires_absences'));
vector('27-cancelled-without-absences', 'cancelled without absences is a caller bug',
  { absences: [A('t-2', 1, [2])], overlays: [S(1, 'c-1', 2, 'cancelled')] }, invalid('requires_absences'),
  (input) => { delete input.absences; });
vector('28-moved-lesson-other-teacher', 'A lesson with origin=plan taught by a teacher outside the plan is not exempt',
  { absences: [A('t-1', 1, [1, 3])], overlays: [M(1, 'c-1', 1, 3, 4), S(1, 'c-2', 3)] },
  rejected({ rule: 'teacher_not_in_plan', class_id: 'c-1', subject_id: 's-math', teacher_id: 't-4' }),
  (input) => { const l = input.timetable.lessons.find((x) => x.class_id === 'c-1' && x.day === 3 && x.lesson_no === 4); l.teacher_id = 't-4'; });
vector('29-moved-target-capacity-at-limit', 'Same move as 11 with passport 45: exactly at the limit passes',
  { snapshot: withSnapshot((s) => { s.capacity = { passport: 45 }; }), absences: [A('t-3', 4, [1])], overlays: [M(4, 'c-2', 1, 3, 5)] }, ok);
vector('30-self-study-takes-teacher-off-site', 'The absent teacher is not on site and self-study adds no supervisor: 43 <= 43',
  { snapshot: withSnapshot((s) => { s.capacity = { passport: 43 }; }),
    absences: [A('t-2', 1, [2, 4]), A('t-2', 2, [2]), A('t-2', 3, [4])],
    overlays: [S(1, 'c-1', 2), S(1, 'c-2', 4), S(2, 'c-1', 2), S(3, 'c-2', 4)] }, ok);
vector('31-substitute-adds-teacher-on-site', 'A substitute without other in-person lessons adds one person: 45 > 44',
  { snapshot: withSnapshot((s) => { s.capacity = { passport: 44 }; }), absences: [A('t-2', 1, [2])], overlays: [T(1, 'c-1', 2, 't-4')] },
  rejected({ rule: 'capacity_exceeded', day: 1, condition: 'passport', value: 45, limit: 44 }));
vector('32-moved-lesson-out-of-range', 'A lesson moved past lessons_per_day',
  { absences: [A('t-1', 1, [1, 3])], overlays: [M(1, 'c-1', 1, 3, 7), S(1, 'c-2', 3)] },
  rejected({ rule: 'lesson_no_out_of_range', class_id: 'c-1', day: 3, lesson_no: 7, limit: 6 }));
vector('33-moved-lesson-teacher-unavailable', 'A lesson moved onto its teacher\'s unavailable weekday',
  { absences: [A('t-3', 4, [1])], overlays: [M(4, 'c-2', 1, 2, 3)] },
  rejected({ rule: 'teacher_unavailable_day', teacher_id: 't-3', day: 2 }));
vector('34-moved-lesson-mixed-format', 'An in-person lesson moved onto a day where its teacher teaches remotely',
  { absences: [A('t-2', 1, [4])], overlays: [M(1, 'c-2', 4, 4, 3)] },
  rejected({ rule: 'teacher_mixed_format', teacher_id: 't-2', day: 4 }));
vector('35-holiday-frees-weekly-limit', 'Holiday lessons do not count: t-1 6 - 2 + 2 = 6 <= 6',
  { holidays: [3], absences: [A('t-2', 1, [2, 4])], overlays: [T(1, 'c-1', 2, 't-1'), T(1, 'c-2', 4, 't-1')] }, ok);
vector('36-lesson-and-not-held-same-slot', 'Materialisation bug: a cancelled lesson is still in the week',
  { absences: [A('t-2', 4, [2])], overlays: [S(4, 'c-1', 2, 'cancelled')] },
  rejected(
    { rule: 'teacher_unavailable_day', teacher_id: 't-2', day: 4, lesson_no: 2 },
    { rule: 'plan_hours_mismatch', class_id: 'c-1', subject_id: 's-ukr', value: 4, limit: 3 },
  ),
  (input) => { input.timetable.lessons.push({ class_id: 'c-1', day: 4, lesson_no: 2, subject_id: 's-ukr', teacher_id: 't-2' }); });
vector('37-alert-substitute-passport', 'Model 1.2: a substitute exceeds the passport (45 > 44); seats only count students (40 <= 40)',
  { snapshot: withSnapshot((s) => { s.kind = 'alert'; s.capacity = { seats: 40, passport: 44 }; }), template: alertTemplate(),
    absences: [A('t-2', 1, [2])], overlays: [T(1, 'c-1', 2, 't-4')] },
  rejected({ rule: 'capacity_exceeded', day: 1, condition: 'passport', value: 45, limit: 44 }));
vector('38-self-study-on-non-school-day', 'self_study on a weekday outside school_days is a caller bug',
  { absences: [A('t-2', 1, [2])], overlays: [S(1, 'c-1', 2)] }, invalid('not_held_day'),
  (input) => { input.timetable.not_held[0].day = 6; input.absences[0].day = 6; });
vector('39-holiday-on-school-day', 'holidays must not be school days',
  { holidays: [3] }, invalid('not_held_day'), (input) => { input.snapshot.school_days.push(3); input.snapshot.school_days.sort(); });
vector('40-absence-of-unknown-teacher', 'An absence of a teacher outside the snapshot (a typo would silently not match)',
  { absences: [A('t-2', 2, [2])], overlays: [T(2, 'c-1', 2, 't-4')] }, invalid('unknown_reference'),
  (input) => { input.absences.push(A('t-01', 1, [1])); });

// Pairs for newConflicts(baseline, effective): baseline = template + approved overlays (none here) with their
// absences; effective = baseline + the proposal and its absence. Same snapshot in both.
const pairs = [];
function pair(name, description, snapshot, proposal, added, template = baseTemplate()) {
  const baseline = effective({ snapshot, template, holidays: [], absences: [], overlays: [] });
  const eff = effective({ snapshot, template, holidays: [], ...proposal });
  pairs.push({ name, body: { description, baseline, effective: eff, expected: { added } } });
}
pair('a1-stale-week-unrelated', 'The week already breaks the fresh snapshot (plan hours changed); a clean substitution adds nothing',
  withSnapshot((s) => { s.rows[3].hours = 3; }), { absences: [A('t-2', 2, [2])], overlays: [T(2, 'c-1', 2, 't-4')] }, []);
pair('a2-second-lesson-on-unavailable-day', 'Stale unavailable day: the substitute gets another lesson on it — same conflict, more violations',
  withSnapshot((s) => { s.teachers[1].unavailable_days = [1]; }), { absences: [A('t-1', 1, [1])], overlays: [T(1, 'c-1', 1, 't-2')] },
  [{ rule: 'teacher_unavailable_day', teacher_id: 't-2', day: 1 }]);
pair('a3-capacity-worse', 'Over capacity already (44 > 43); a substitute makes it 45',
  withSnapshot((s) => { s.capacity = { passport: 43 }; }), { absences: [A('t-2', 1, [2])], overlays: [T(1, 'c-1', 2, 't-4')] },
  [{ rule: 'capacity_exceeded', day: 1, condition: 'passport', value: 45, limit: 43 }]);
pair('a4-capacity-better', 'Over capacity already (44 > 42); the absent teacher leaves the site: 43 is better, not new',
  withSnapshot((s) => { s.capacity = { passport: 42 }; }), { absences: [A('t-2', 2, [2])], overlays: [S(2, 'c-1', 2)] }, []);
pair('a5-new-double-booking', 'A stale week plus a substitute who is busy in that slot: only the double booking is new',
  withSnapshot((s) => { s.rows[3].hours = 3; s.teachers[0].weekly_limit = 10; }),
  { absences: [A('t-2', 2, [2])], overlays: [T(2, 'c-1', 2, 't-1')] },
  [{ rule: 'teacher_double_booked', teacher_id: 't-1', day: 2, lesson_no: 2 }]);
pair('a6-weekly-limit-eased', 'Weekly limit already exceeded (5 > 3); self-study lowers it to 4: not new',
  withSnapshot((s) => { s.teachers[1].weekly_limit = 3; }), { absences: [A('t-2', 1, [2])], overlays: [S(1, 'c-1', 2)] }, []);

pair('a7-mixed-format-worse', 'A week where t-2 already mixes formats on day 4; a substitution gives him one more in-person lesson that day',
  withSnapshot((s) => { s.rows[3].hours = 3; }), { absences: [A('t-3', 4, [1])], overlays: [T(4, 'c-2', 1, 't-2')] },
  [{ rule: 'teacher_mixed_format', teacher_id: 't-2', day: 4 }],
  (() => { const t = baseTemplate(); t.lessons.push(L('c-2', 4, 3, 's-ukr', 't-2')); return t; })());
for (const v of vectors) writeFileSync(join(OUT, `${v.name}.json`), JSON.stringify(v.body, null, 2) + '\n');
const PAIRS = `${OUT}-approve`;
rmSync(PAIRS, { recursive: true, force: true });
mkdirSync(PAIRS, { recursive: true });
for (const p of pairs) writeFileSync(join(PAIRS, `${p.name}.json`), JSON.stringify(p.body, null, 2) + '\n');
console.log(`${vectors.length} vectors -> ${OUT}, ${pairs.length} pairs -> ${PAIRS}`);
