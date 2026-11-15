// Builds vectors/substitution-solve/*.json: node scripts/gen-substitution-solve-vectors.mjs vectors/substitution-solve
// ADR 2026-11-15-solver-substitution-engine. Every vector states its expectation by hand; the generator only spares
// copy-paste of the base school and keeps `rows` equal to the template (so the baseline week has no plan conflicts).
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith('.json')) rmSync(join(OUT, f));

// ISO week 2026-W47: Monday 2026-11-16 .. Friday 2026-11-20 (school days 1..5).
const DATE = { 1: '2026-11-16', 2: '2026-11-17', 3: '2026-11-18', 4: '2026-11-19', 5: '2026-11-20' };
const DAY = Object.fromEntries(Object.entries(DATE).map(([d, s]) => [s, Number(d)]));
const ALL_DATES = Object.values(DATE);

const L = (class_id, day, lesson_no, subject_id, teacher_id) => ({ class_id, day, lesson_no, subject_id, teacher_id });

// Mon, Wed, Thu, Fri: three lessons per class. t-1 (maths) teaches c-1 L1 and c-2 L2 every day.
const otherDay = (d) => [
  L('c-1', d, 1, 's-math', 't-1'), L('c-1', d, 2, 's-ukr', 't-2'), L('c-1', d, 3, 's-art', 't-5'),
  L('c-2', d, 1, 's-ukr', 't-2'), L('c-2', d, 2, 's-math', 't-1'), L('c-2', d, 3, 's-eng', 't-3'),
  L('c-3', d, 1, 's-eng', 't-3'), L('c-3', d, 2, 's-math', 't-4'), L('c-3', d, 3, 's-ukr', 't-2'),
];
// Tuesday 2026-11-17, the usual absence date. Free in slot L1: t-4; in L2: t-3. t-5 has no lesson on Tuesday.
const TUESDAY = [
  L('c-1', 2, 1, 's-math', 't-1'), L('c-1', 2, 2, 's-ukr', 't-2'), L('c-1', 2, 3, 's-eng', 't-3'),
  L('c-2', 2, 1, 's-ukr', 't-2'), L('c-2', 2, 2, 's-math', 't-1'), L('c-2', 2, 3, 's-phys', 't-4'),
  L('c-3', 2, 1, 's-eng', 't-3'), L('c-3', 2, 2, 's-math', 't-4'), L('c-3', 2, 3, 's-ukr', 't-2'),
];
// Variant: c-3's maths moves from L2 to L4, so t-4 (a maths teacher) is free in L1 and L2.
const TUESDAY_T4_FREE = TUESDAY.map((l) => (l.class_id === 'c-3' && l.lesson_no === 2 ? { ...l, lesson_no: 4 } : l));

const LIMITS = { 't-1': 12, 't-2': 18, 't-3': 12, 't-4': 12, 't-5': 12 };
const SUBJECTS = [
  { id: 's-math', priority_area: true, no_shelter: false },
  { id: 's-ukr', priority_area: false, no_shelter: false },
  { id: 's-eng', priority_area: false, no_shelter: false },
  { id: 's-phys', priority_area: false, no_shelter: false },
  { id: 's-art', priority_area: false, no_shelter: false },
];
const CLASSES = [
  { id: 'c-1', students: 20, priority: true },
  { id: 'c-2', students: 20, priority: false },
  { id: 'c-3', students: 20, priority: false },
];

const PARAMS = {
  works_that_day: 'has_lesson_that_day',
  off_profile: 'no_row_with_subject',
  equal_distance: 'later_date',
  step2_scope: 'per_lesson',
  self_study_step: 'last_step_that_ran',
};

const absence = (teacher_id, date, lesson_nos = null) => ({ teacher_id, date, lesson_nos });

let seq = 0;
const request = (o = {}) => {
  seq += 1;
  const date = o.date ?? DATE[2];
  const tuesday = o.tuesday ?? TUESDAY;
  const lessons = [1, 3, 4, 5].flatMap(otherDay).concat(tuesday)
    .sort((a, b) => a.day - b.day || a.class_id.localeCompare(b.class_id) || a.lesson_no - b.lesson_no);
  const remote = new Set((o.remote ?? []).map(([c, d]) => `${c}/${d}`));
  const dayFormats = [];
  for (const c of CLASSES) for (const d of [1, 2, 3, 4, 5]) {
    if (lessons.some((l) => l.class_id === c.id && l.day === d)) dayFormats.push({ class_id: c.id, day: d, in_person: !remote.has(`${c.id}/${d}`) });
  }
  const rows = new Map();
  for (const l of lessons) {
    const k = `${l.class_id}/${l.subject_id}`;
    const r = rows.get(k) ?? { class_id: l.class_id, subject_id: l.subject_id, teacher_id: l.teacher_id, hours: 0 };
    if (r.teacher_id !== l.teacher_id) throw new Error(`two teachers for ${k}`);
    r.hours += 1;
    rows.set(k, r);
  }
  const approved = o.approved ?? [];
  const nonSchool = o.non_school_dates;
  const absences = o.absences ?? [absence('t-1', date)];
  // Weekly load as validator-lib counts it: template lessons on held dates + approved substitutions taken.
  const load = (t) => lessons.filter((l) => l.teacher_id === t && !(nonSchool ?? []).includes(DATE[l.day])).length
    + approved.filter((a) => (a.kind ?? 'teacher') === 'teacher' && a.teacher_id === t).length;
  const limits = { ...LIMITS, ...(o.limits ?? {}) };
  for (const t of o.exhaust ?? []) limits[t] = load(t);
  const own = absences.find((a) => a.teacher_id === 't-1' && a.date === date);
  const data = {
    job_id: `5d0b5e1c-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    date,
    absence_dates: o.absence_dates ?? [date],
    absent_teacher_id: 't-1',
    lessons: lessons
      .filter((l) => l.teacher_id === 't-1' && l.day === DAY[date] && (own.lesson_nos === null || own.lesson_nos.includes(l.lesson_no)))
      .map(({ class_id, lesson_no }) => ({ class_id, lesson_no })),
    not_before: o.not_before ?? DATE[1],
    iso_week: '2026-W47',
    snapshot_version: 7,
    time_limit_s: 30,
    queue_deadline_at: `${o.not_before ?? DATE[1]}T08:10:00+02:00`,
    school_days: [1, 2, 3, 4, 5],
    lessons_per_day: 6,
    staff: 2,
    capacity: { passport: 200 },
    classes: CLASSES,
    subjects: SUBJECTS,
    teachers: Object.entries(limits).map(([id, weekly_limit]) => ({ id, weekly_limit, unavailable_days: o.unavailable?.[id] ?? [] })),
    rows: [...rows.values()],
    template: { timetable_id: '9e1f7a20-3c4b-4d5e-8f60-7a8b9c0d1e2f', kind: 'main', lessons, day_formats: dayFormats },
    approved_substitutions: approved,
    absences,
    allow_support_moves: false,
  };
  if (nonSchool !== undefined) data.non_school_dates = nonSchool;
  return data;
};

const teacher = (class_id, lesson_no, teacher_id, off_profile, step = 1) => ({ class_id, lesson_no, kind: 'teacher', teacher_id, off_profile, step });
const moved = (class_id, lesson_no, date, lesson_no_in, step) => ({ class_id, lesson_no, kind: 'moved', moved_to: { date, lesson_no_in }, step });
const selfStudy = (class_id, lesson_no, step) => ({ class_id, lesson_no, kind: 'self_study', step });
const except = (...dates) => ALL_DATES.filter((d) => !dates.includes(d));
const FREE_AFTER_L3 = [4, 5, 6];

const vectors = [];
const add = (name, description, req, expect, alternatives) => {
  const body = {
    name,
    description,
    params: PARAMS,
    given: { request: req },
    expect: { status_in: ['OPTIMAL', 'FEASIBLE'], extra_rows: [], ...expect },
  };
  if (alternatives) body.alternatives = alternatives;
  vectors.push({ name, body });
};

add('01-step1-free-teacher',
  'Step 1. t-1 is absent all Tuesday. L1: only t-4 is free and works that day (maths in c-3: on profile). L2: only t-3 (English only: off profile). t-5 has no lesson on Tuesday.',
  request(),
  { step: 1, never_teachers: ['t-1', 't-5'], lessons: [teacher('c-1', 1, 't-4', false), teacher('c-2', 2, 't-3', true)] });

add('02-step1-prefers-on-profile',
  'Step 1 objective: coverage >> off profile. In L2 both t-3 (off profile) and t-4 (maths, on profile) are free: t-4 takes both lessons.',
  request({ tuesday: TUESDAY_T4_FREE }),
  { step: 1, never_teachers: ['t-1', 't-5'], lessons: [teacher('c-1', 1, 't-4', false), teacher('c-2', 2, 't-4', false)] });

add('03-step2-move-within-day',
  't-1 is absent only in L1-L2 on Tuesday; t-3 and t-4 have no weekly limit left. Step 2 moves both lessons to hours of the same day where t-1 is present and the class is free (L4-L6); t-1 teaches one lesson per slot, so the two targets differ.',
  request({ absences: [absence('t-1', DATE[2], [1, 2])], exhaust: ['t-3', 't-4'] }),
  {
    step: 2, never_teachers: ['t-1', 't-3', 't-4', 't-5'], never_dates: except(DATE[2]),
    lessons: [moved('c-1', 1, DATE[2], FREE_AFTER_L3, 2), moved('c-2', 2, DATE[2], FREE_AFTER_L3, 2)],
  });

add('04-step2-only-for-uncovered-lessons',
  'Steps are sequential and per lesson: step 1 fixes c-2 L2 -> t-3; only c-1 L1 (no free teacher: t-4 has no limit left) goes to step 2 and moves within Tuesday.',
  request({ absences: [absence('t-1', DATE[2], [1, 2])], exhaust: ['t-4'] }),
  {
    step: 2, never_teachers: ['t-1', 't-4', 't-5'], never_dates: except(DATE[2]),
    lessons: [moved('c-1', 1, DATE[2], FREE_AFTER_L3, 2), teacher('c-2', 2, 't-3', true, 1)],
  });

add('05-step3-neighbour-date',
  'Step 3. t-1 is absent all Tuesday (step 2 has no moves), no free teacher. not_before = Tuesday, so Monday is out; the nearest date Wednesday takes both lessons (free L4-L6) and the later dates are not tried.',
  request({ exhaust: ['t-3', 't-4'], non_school_dates: [], not_before: DATE[2] }),
  {
    step: 3, never_teachers: ['t-1', 't-3', 't-4', 't-5'], never_dates: except(DATE[3]),
    lessons: [moved('c-1', 1, DATE[3], FREE_AFTER_L3, 3), moved('c-2', 2, DATE[3], FREE_AFTER_L3, 3)],
  });

add('06-self-study-when-nothing-fits',
  't-1 is absent the whole week and nobody is free: every lesson is self_study (step 3 ran, non_school_dates was sent). cancelled is never proposed.',
  request({
    absence_dates: ALL_DATES, absences: ALL_DATES.map((d) => absence('t-1', d)), exhaust: ['t-3', 't-4'], non_school_dates: [],
  }),
  { step: 3, never_teachers: ['t-1', 't-2', 't-3', 't-4', 't-5'], lessons: [selfStudy('c-1', 1, 3), selfStudy('c-2', 2, 3)] });

add('07-forbidden-substitute-absent',
  'Forbidden candidate: t-4 is absent in L1 only (absences[], lesson_nos [1]). He cannot take c-1 L1 but still takes c-2 L2. No step 3 (no non_school_dates), t-1 absent all day: c-1 L1 is self_study at step 2.',
  request({ tuesday: TUESDAY_T4_FREE, absences: [absence('t-1', DATE[2]), absence('t-4', DATE[2], [1])] }),
  { step: 2, never_teachers: ['t-1', 't-5'], lessons: [selfStudy('c-1', 1, 2), teacher('c-2', 2, 't-4', false)] });

add('08-forbidden-unavailable-day',
  'Forbidden candidate: t-4 was marked unavailable on Tuesdays after the template was published (a stale baseline: his own Tuesday lessons stay). He gets no new lesson on Tuesday; c-2 L2 goes to t-3, c-1 L1 is self_study.',
  request({ tuesday: TUESDAY_T4_FREE, unavailable: { 't-4': [2] } }),
  { step: 2, never_teachers: ['t-1', 't-4', 't-5'], lessons: [selfStudy('c-1', 1, 2), teacher('c-2', 2, 't-3', true)] });

add('09-forbidden-weekly-limit-exhausted',
  'Forbidden candidate: t-4 already took an approved substitution on Monday (c-1 L1); with it his weekly load equals his limit (7), so he cannot take c-1 L1 on Tuesday.',
  request({
    approved: [{ date: DATE[1], class_id: 'c-1', lesson_no: 1, kind: 'teacher', teacher_id: 't-4' }],
    absences: [absence('t-1', DATE[1], [1]), absence('t-1', DATE[2])],
    limits: { 't-4': 7 },
  }),
  { step: 2, never_teachers: ['t-1', 't-4', 't-5'], lessons: [selfStudy('c-1', 1, 2), teacher('c-2', 2, 't-3', true)] });

add('10-forbidden-no-lessons-that-day',
  '"Works that day" = has at least one lesson that day (Roman, 15.11.2026). t-5 is free but has no lesson on Tuesday, so he is not a candidate; t-4 has no limit left: c-1 L1 is self_study.',
  request({ exhaust: ['t-4'] }),
  { step: 2, never_teachers: ['t-1', 't-4', 't-5'], lessons: [selfStudy('c-1', 1, 2), teacher('c-2', 2, 't-3', true)] },
  [{
    params: { works_that_day: 'any_available_teacher' },
    note: 'Rejected interpretation, kept to show what the parameter changes: t-5 (art) becomes a candidate.',
    expect: {
      status_in: ['OPTIMAL', 'FEASIBLE'], extra_rows: [], step: 1, never_teachers: ['t-1', 't-4'],
      lessons: [teacher('c-1', 1, 't-5', true), { class_id: 'c-2', lesson_no: 2, kind: 'teacher', teacher_id_in: ['t-3', 't-5'], off_profile: true, step: 1 }],
    },
  }]);

add('11-forbidden-mixed-format',
  'Forbidden candidate: c-3 is remote on Tuesday and t-3 teaches only c-3 that day. He is free in L1 but an in-person lesson would mix formats (spec §06: "works that day in the same format"). t-4 and t-5 have no limit left: both lessons are self_study.',
  request({
    tuesday: [
      L('c-1', 2, 1, 's-math', 't-1'), L('c-1', 2, 2, 's-ukr', 't-2'), L('c-1', 2, 3, 's-art', 't-5'),
      L('c-2', 2, 1, 's-ukr', 't-2'), L('c-2', 2, 2, 's-math', 't-1'), L('c-2', 2, 3, 's-phys', 't-4'),
      L('c-3', 2, 2, 's-eng', 't-3'), L('c-3', 2, 3, 's-eng', 't-3'),
    ],
    remote: [['c-3', 2]],
    exhaust: ['t-4', 't-5'],
  }),
  { step: 2, never_teachers: ['t-1', 't-3', 't-4', 't-5'], lessons: [selfStudy('c-1', 1, 2), selfStudy('c-2', 2, 2)] });

add('12-no-move-into-slot-freed-by-same-job',
  'allow_support_moves=false: c-1 is full in L2-L6 on Tuesday and t-1 is absent only in L1. The only way to place c-1 L1 is a chain: t-5\'s art L4 moves into the slot that the maths lesson frees (L1) and the maths lesson takes L4. A move into a slot freed by another proposal of the same job is forbidden without the flag, so c-1 L1 is self_study and no row outside `lessons` appears.',
  request({
    tuesday: [
      L('c-1', 2, 1, 's-math', 't-1'), L('c-1', 2, 2, 's-ukr', 't-2'), L('c-1', 2, 3, 's-eng', 't-3'),
      L('c-1', 2, 4, 's-art', 't-5'), L('c-1', 2, 5, 's-ukr', 't-2'), L('c-1', 2, 6, 's-eng', 't-3'),
      L('c-2', 2, 1, 's-ukr', 't-2'), L('c-2', 2, 2, 's-math', 't-1'), L('c-2', 2, 3, 's-phys', 't-4'),
      L('c-3', 2, 1, 's-eng', 't-3'), L('c-3', 2, 2, 's-math', 't-4'), L('c-3', 2, 3, 's-ukr', 't-2'),
    ],
    absences: [absence('t-1', DATE[2], [1])],
    exhaust: ['t-4', 't-5'],
  }),
  { step: 2, never_teachers: ['t-1', 't-4', 't-5'], never_dates: except(DATE[2]), lessons: [selfStudy('c-1', 1, 2)] },
  [{
    stage: 'after_defence',
    given_patch: { allow_support_moves: true },
    note: 'With the flag (after the defence) the chain is allowed; the expected optimum is c-1 L1 moved to L4 plus a support row c-1 L4 (art) moved to L1, both at step 2. Only the weak properties below are normative until the support-move model exists.',
    expect: {
      status_in: ['OPTIMAL', 'FEASIBLE'], step: 2, extra_rows_allowed: true,
      lessons: [{ class_id: 'c-1', lesson_no: 1, kind_in: ['teacher', 'moved'], step: 2 }],
    },
  }]);

add('13-baseline-week-with-overlays',
  'The baseline already carries approved overlays of every kind: t-3 substitutes on Monday (c-1 L2) and on Tuesday (c-3 L2, t-4 absent in L2), t-3\'s Wednesday lesson moved to Tuesday L4, a lesson on Thursday is cancelled. It is stale: t-3 is over his limit (12 > 11). A solution still exists: c-1 L1 -> t-4 (absent only in L2), and c-2 L2 is self_study because t-3 is busy in L2 and has no limit left.',
  request({
    approved: [
      { date: DATE[1], class_id: 'c-1', lesson_no: 2, kind: 'teacher', teacher_id: 't-3' },
      { date: DATE[2], class_id: 'c-3', lesson_no: 2, kind: 'teacher', teacher_id: 't-3' },
      { date: DATE[3], class_id: 'c-2', lesson_no: 3, kind: 'moved', moved_to: { date: DATE[2], lesson_no: 4 } },
      { date: DATE[4], class_id: 'c-3', lesson_no: 3, kind: 'cancelled' },
    ],
    absences: [
      absence('t-2', DATE[1], [2]), absence('t-1', DATE[2]), absence('t-4', DATE[2], [2]),
      absence('t-3', DATE[3], [3]), absence('t-2', DATE[4], [3]),
    ],
    limits: { 't-3': 11 },
  }),
  { step: 2, never_teachers: ['t-1', 't-3', 't-5'], lessons: [teacher('c-1', 1, 't-4', false), selfStudy('c-2', 2, 2)] });

add('14-step3-iso-week-border',
  'Absence on Friday 2026-11-20, not_before = Friday, nobody free. The step 3 window is empty: Saturday is not a school day and Monday 2026-11-23 is in the next ISO week, so both lessons are self_study.',
  request({
    date: DATE[5], absences: [absence('t-1', DATE[5])], not_before: DATE[5], non_school_dates: [], exhaust: ['t-3', 't-4', 't-5'],
  }),
  {
    step: 3, never_teachers: ['t-1', 't-3', 't-4', 't-5'], never_dates: [...ALL_DATES, '2026-11-21', '2026-11-23'],
    lessons: [selfStudy('c-1', 1, 3), selfStudy('c-2', 2, 3)],
  });

add('15-step3-not-before',
  'Absence on Wednesday, the job was created on Wednesday (not_before), Thursday is a non-school date. Tuesday would be nearest but is before not_before: both lessons go to Friday.',
  request({
    date: DATE[3], absences: [absence('t-1', DATE[3])], not_before: DATE[3], non_school_dates: [DATE[4]], exhaust: ['t-3', 't-4', 't-5'],
  }),
  {
    step: 3, never_teachers: ['t-1', 't-3', 't-4', 't-5'], never_dates: except(DATE[5]),
    lessons: [moved('c-1', 1, DATE[5], FREE_AFTER_L3, 3), moved('c-2', 2, DATE[5], FREE_AFTER_L3, 3)],
  });

add('16-step3-non-school-dates',
  'Wednesday 2026-11-18 is a non-school date: Monday and Wednesday are equally near and the later one would win, but Wednesday is not in the window, so both lessons go to Monday.',
  request({ exhaust: ['t-3', 't-4'], non_school_dates: [DATE[3]] }),
  {
    step: 3, never_teachers: ['t-1', 't-3', 't-4', 't-5'], never_dates: except(DATE[1]),
    lessons: [moved('c-1', 1, DATE[1], FREE_AFTER_L3, 3), moved('c-2', 2, DATE[1], FREE_AFTER_L3, 3)],
  });

add('17-step3-equal-distance-later-date',
  'Monday and Wednesday are both one day from Tuesday: the later date is tried first (more time to warn parents; Roman, 15.11.2026).',
  request({ exhaust: ['t-3', 't-4'], non_school_dates: [] }),
  {
    step: 3, never_teachers: ['t-1', 't-3', 't-4', 't-5'], never_dates: except(DATE[3]),
    lessons: [moved('c-1', 1, DATE[3], FREE_AFTER_L3, 3), moved('c-2', 2, DATE[3], FREE_AFTER_L3, 3)],
  },
  [{
    params: { equal_distance: 'earlier_date' },
    note: 'Rejected interpretation: the earlier date wins the tie.',
    expect: {
      status_in: ['OPTIMAL', 'FEASIBLE'], extra_rows: [], step: 3, never_teachers: ['t-1', 't-3', 't-4', 't-5'], never_dates: except(DATE[1]),
      lessons: [moved('c-1', 1, DATE[1], FREE_AFTER_L3, 3), moved('c-2', 2, DATE[1], FREE_AFTER_L3, 3)],
    },
  }]);

add('18-step3-skips-dates-of-the-same-absence',
  'The absence covers Tuesday and Wednesday (absence_dates, absences[]); not_before = Tuesday. Wednesday is the nearest date but t-1 is absent there, so both lessons go to Thursday.',
  request({
    absence_dates: [DATE[2], DATE[3]], absences: [absence('t-1', DATE[2]), absence('t-1', DATE[3])],
    not_before: DATE[2], non_school_dates: [], exhaust: ['t-3', 't-4'],
  }),
  {
    step: 3, never_teachers: ['t-1', 't-3', 't-4', 't-5'], never_dates: except(DATE[4]),
    lessons: [moved('c-1', 1, DATE[4], FREE_AFTER_L3, 3), moved('c-2', 2, DATE[4], FREE_AFTER_L3, 3)],
  });

for (const v of vectors) writeFileSync(join(OUT, `${v.name}.json`), JSON.stringify(v.body, null, 2) + '\n');
console.log(`${vectors.length} vectors -> ${OUT}`);
