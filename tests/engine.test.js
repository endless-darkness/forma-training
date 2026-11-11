import test from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES, TEMPLATES } from '../js/data.js';
import { isValidSet, recommend, weeklyVolume, trainingStats, sessionAdvice } from '../js/engine.js';

const exercise = { id: 'press', name: 'Press', muscle: 'Chest', repMin: 8, repMax: 12, targetSets: 3, restSeconds: 120, incrementKg: 2.5 };
let sequence = 0;
const set = (overrides = {}) => ({ id: `set-${++sequence}`, weightKg: 40, reps: 12, rir: 2, warmup: false, done: true, ...overrides });
const sets = (count = 3, overrides = {}) => Array.from({ length: count }, () => set(overrides));
function session(day, entries = sets(), overrides = {}) {
  const startedAt = new Date(2025, 0, day, 10).toISOString();
  const endedAt = new Date(2025, 0, day, 11).toISOString();
  return { id: `session-${++sequence}`, templateId: 'upper-a', name: 'Upper A', startedAt, endedAt, notes: '', exercises: [{ ...exercise, id: `log-${sequence}`, exerciseId: exercise.id, sets: entries }], ...overrides };
}

test('set validation permits bodyweight but rejects corrupt or impossible values', () => {
  assert.equal(isValidSet(set({ weightKg: 0, reps: 1, rir: 0 })), true);
  for (const invalid of [null, {}, set({ weightKg: NaN }), set({ weightKg: Infinity }), set({ weightKg: -1 }), set({ weightKg: 1001 }), set({ weightKg: '40' }), set({ reps: 0 }), set({ reps: 101 }), set({ reps: 8.5 }), set({ rir: -1 }), set({ rir: 11 }), set({ rir: 1.5 })]) {
    assert.equal(isValidSet(invalid), false);
  }
});

test('a new exercise asks the lifter to establish a load', () => {
  const advice = recommend(exercise, []);
  assert.equal(advice.weightKg, null);
  assert.equal(advice.increase, false);
});

test('one successful exposure does not trigger an increase', () => {
  assert.deepEqual({ ...recommend(exercise, [session(1)]), title: '', detail: '' }, { title: '', detail: '', weightKg: 40, increase: false });
});

test('two complete exposures at the same load trigger one small increase', () => {
  const advice = recommend(exercise, [session(3), session(1)]);
  assert.equal(advice.weightKg, 42.5);
  assert.equal(advice.increase, true);
});

test('an empty latest exposure blocks progression instead of skipping to older wins', () => {
  const advice = recommend(exercise, [session(1), session(3), session(5, [])]);
  assert.equal(advice.weightKg, 40);
  assert.equal(advice.increase, false);
});

test('unfinished or invalid latest working sets block progression', () => {
  for (const latest of [sets(2), [...sets(), set({ done: false })], [...sets(), set({ reps: 0 })], sets(3, { done: false })]) {
    assert.equal(recommend(exercise, [session(1), session(3), session(5, latest)]).increase, false);
  }
});

test('unfinished sessions and future sessions are never used as evidence', () => {
  const draft = session(3, sets(), { endedAt: null });
  const future = session(5, sets(), { startedAt: '2999-01-01T10:00:00.000Z', endedAt: '2999-01-01T11:00:00.000Z' });
  assert.equal(recommend(exercise, [session(1), draft, future]).increase, false);
});

test('warm-ups neither count toward the set target nor block successful working sets', () => {
  const warmup = () => set({ weightKg: 10, reps: 5, rir: 5, warmup: true });
  assert.equal(recommend(exercise, [session(1, [warmup(), ...sets()]), session(3, [warmup(), ...sets()])]).increase, true);
  assert.equal(recommend(exercise, [session(1, [warmup(), ...sets(2)]), session(3, [warmup(), ...sets(2)])]).increase, false);
});

test('mixed loads suggest the lightest recent working load without progression', () => {
  const advice = recommend(exercise, [session(1), session(3, [set({ weightKg: 35 }), ...sets(2)])]);
  assert.equal(advice.weightKg, 35);
  assert.equal(advice.increase, false);
});

test('a changed load needs two qualifying exposures before another increase', () => {
  const first = session(1);
  const second = session(3);
  const third = session(5, sets(3, { weightKg: 42.5 }));
  assert.equal(recommend(exercise, [first, second, third]).increase, false);
  const fourth = session(7, sets(3, { weightKg: 42.5 }));
  assert.equal(recommend(exercise, [first, second, third, fourth]).weightKg, 45);
});

test('falling short of the rep target or reaching failure prevents an increase', () => {
  for (const entries of [sets(3, { reps: 11 }), sets(3, { rir: 0 })]) {
    assert.equal(recommend(exercise, [session(1), session(3, entries)]).increase, false);
  }
});

test('bodyweight and invalid increments do not produce automatic load increases', () => {
  assert.equal(recommend(exercise, [session(1, sets(3, { weightKg: 0 })), session(3, sets(3, { weightKg: 0 }))]).increase, false);
  for (const incrementKg of [0, -2.5, NaN, Infinity, 1000]) {
    assert.equal(recommend({ ...exercise, incrementKg }, [session(1), session(3)]).increase, false);
  }
});

test('importing the same session twice does not create a second exposure', () => {
  const first = session(1);
  assert.equal(recommend(exercise, [first, structuredClone(first)]).increase, false);
});

test('invalid dates and reversed timestamps do not qualify as finished sessions', () => {
  const malformed = session(3, sets(), { endedAt: 'invalid' });
  const reversed = session(5, sets(), { endedAt: new Date(2025, 0, 4).toISOString() });
  assert.equal(recommend(exercise, [session(1), malformed, reversed]).increase, false);
});

test('advice works with an exercise log and ignores a different exercise', () => {
  const other = session(5);
  other.exercises[0].exerciseId = 'squat';
  const log = { ...exercise, id: 'instance-id', exerciseId: exercise.id };
  assert.equal(recommend(log, [session(1), session(3), other]).increase, true);
});

test('seven-day volume uses local calendar dates and excludes drafts, future and invalid sets', () => {
  const now = new Date(2025, 0, 10, 12);
  const boundary = session(4, [set(), set({ warmup: true }), set({ done: false }), set({ weightKg: NaN })], { startedAt: new Date(2025, 0, 4, 0).toISOString(), endedAt: new Date(2025, 0, 4, 0, 30).toISOString() });
  const today = session(10, sets(2));
  today.exercises.push({ ...exercise, exerciseId: 'row', muscle: 'Back', sets: sets(2) });
  const tooOld = session(3);
  const draft = session(9, sets(), { endedAt: null });
  const future = session(10, sets(), { startedAt: new Date(2025, 0, 10, 13).toISOString(), endedAt: new Date(2025, 0, 10, 14).toISOString() });
  assert.deepEqual(weeklyVolume([boundary, today, tooOld, draft, future, structuredClone(today)], now), { Chest: 3, Back: 2 });
});

test('statistics use completed working sets, load times reps, and actual session duration', () => {
  const now = new Date(2025, 0, 10, 12);
  const first = session(4, [set({ weightKg: 20, reps: 10 }), set({ weightKg: 30, reps: 8 }), set({ warmup: true })], { endedAt: new Date(2025, 0, 4, 10, 20).toISOString() });
  const second = session(10, [set({ weightKg: 0, reps: 15 }), set({ done: false })], { endedAt: new Date(2025, 0, 10, 10, 35).toISOString() });
  assert.deepEqual(trainingStats([first, second, session(3), structuredClone(second)], now), { sessions: 2, sets: 3, volumeKg: 440, minutes: 55 });
});

test('empty and malformed histories yield empty statistics', () => {
  assert.deepEqual(trainingStats(undefined), { sessions: 0, sets: 0, volumeKg: 0, minutes: 0 });
  assert.deepEqual(weeklyVolume([null, {}]), {});
});

test('finished sessions without logged working sets do not inflate goals or training minutes', () => {
  const now = new Date(2025, 0, 10, 12);
  const noExercises = session(7, [], { exercises: [] });
  const noSets = session(8, []);
  const unlogged = session(9, [set({ done: false }), set({ warmup: true }), set({ reps: 0 })]);
  const actualTraining = session(10, [set({ weightKg: 0, reps: 10 })]);
  assert.deepEqual(trainingStats([noExercises, noSets, unlogged, actualTraining], now), { sessions: 1, sets: 1, volumeKg: 0, minutes: 60 });
  // The same empty latest exposure still blocks progression; it is not discarded.
  assert.equal(recommend(exercise, [session(1), session(3), noSets]).increase, false);
});

test('untrusted muscle labels cannot mutate the result prototype', () => {
  const entry = session(10);
  entry.exercises[0].muscle = '__proto__';
  const result = weeklyVolume([entry], new Date(2025, 0, 10, 12));
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, '__proto__'), true);
  assert.equal(result.__proto__, 3);
});

test('manual check-ins distinguish missing, low-energy, soreness and pain states', () => {
  assert.equal(sessionAdvice(null).tone, 'neutral');
  assert.equal(sessionAdvice({ energy: 'low', soreness: 0 }).tone, 'caution');
  assert.equal(sessionAdvice({ energy: 'great', soreness: 3 }).tone, 'caution');
  assert.match(sessionAdvice({ energy: 'great', soreness: 0, hasPain: true }).title, /painful/i);
  assert.equal(sessionAdvice({ energy: 'great', soreness: 0 }).tone, 'good');
  assert.match(sessionAdvice({ energy: 'great', soreness: 0 }).detail, /does not require adding/i);
});

test('stale, invalid, or future dated check-ins are not treated as today', () => {
  for (const date of ['2000-01-01T12:00:00.000Z', '2999-01-01T12:00:00.000Z', 'invalid']) {
    assert.equal(sessionAdvice({ date, energy: 'low', hasPain: true }).tone, 'neutral');
  }
  assert.equal(sessionAdvice({ date: new Date().toISOString(), energy: 'okay' }).tone, 'good');
});

test('all templates reference a consistent exercise catalog', () => {
  const ids = new Set(EXERCISES.map(item => item.id));
  assert.equal(ids.size, EXERCISES.length);
  assert.equal(TEMPLATES.length, 4);
  assert.equal(new Set(TEMPLATES.map(item => item.id)).size, TEMPLATES.length);
  for (const template of TEMPLATES) {
    assert.ok(template.exerciseIds.length > 0);
    for (const id of template.exerciseIds) assert.ok(ids.has(id), `Missing exercise: ${id}`);
  }
  for (const entry of EXERCISES) {
    assert.ok(entry.repMin > 0 && entry.repMax >= entry.repMin);
    assert.ok(entry.targetSets > 0 && entry.restSeconds > 0 && entry.incrementKg > 0);
  }
});
