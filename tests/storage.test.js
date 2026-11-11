import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultState, loadState, saveState, parseImport, serializeState, STORAGE_KEY } from '../js/storage.js';

function memoryStorage(initial = null) {
  const values = new Map(initial === null ? [] : [[STORAGE_KEY, initial]]);
  return {
    writes: 0,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { this.writes += 1; values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

function workout(overrides = {}) {
  return {
    id: 'session-1', templateId: 'upper-a', name: 'Upper A',
    startedAt: '2026-11-11T12:00:00.000Z', endedAt: '2026-11-11T13:00:00.000Z',
    exercises: [{
      id: 'entry-1', exerciseId: 'bench', name: 'Bench press', muscle: 'Chest',
      repMin: 8, repMax: 12, targetSets: 3, restSeconds: 120, incrementKg: 2.5,
      sets: [{ id: 'set-1', weightKg: 60, reps: 10, rir: 2, warmup: false, done: true }],
    }],
    notes: 'A good session.\nNext time: one more rep.',
    ...overrides,
  };
}

function populatedState() {
  const state = createDefaultState();
  state.history.push(workout());
  state.draft = workout({ id: 'session-2', endedAt: null });
  state.checkins['2026-11-11'] = { energy: 'okay', soreness: 1, pain: false };
  return state;
}

test('new storage returns independent defaults without writing', () => {
  const storage = memoryStorage();
  const loaded = loadState(storage);
  assert.deepEqual(loaded, { state: createDefaultState(), error: null });
  loaded.state.history.push('local change');
  assert.equal(createDefaultState().history.length, 0);
  assert.equal(storage.writes, 0);
});

test('workouts, draft, settings and check-ins survive a save and reload', () => {
  const storage = memoryStorage();
  const state = populatedState();
  state.settings.unit = 'kg';
  assert.deepEqual(saveState(state, storage), { ok: true, error: null });
  assert.deepEqual(loadState(storage), { state, error: null });
  assert.deepEqual(parseImport(serializeState(state)), state);
});

test('corrupt stored data is retained and cannot be silently overwritten', () => {
  const original = '{broken backup';
  const storage = memoryStorage(original);
  assert.match(loadState(storage).error, /preserved/);
  assert.equal(saveState(createDefaultState(), storage).ok, false);
  assert.equal(storage.getItem(STORAGE_KEY), original);
  assert.equal(storage.writes, 0);
  storage.removeItem(STORAGE_KEY); // Explicit reset/restore by the calling application.
  assert.equal(saveState(createDefaultState(), storage).ok, true);
});

test('future versions are rejected and preserved', () => {
  const future = JSON.stringify({ ...createDefaultState(), version: 2 });
  const storage = memoryStorage(future);
  assert.throws(() => parseImport(future), /version/);
  assert.match(loadState(storage).error, /version/);
  assert.equal(saveState(createDefaultState(), storage).ok, false);
  assert.equal(storage.getItem(STORAGE_KEY), future);
});

test('unavailable and quota-limited storage return useful errors', () => {
  assert.match(loadState(null).error, /unavailable/);
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.match(loadState(blocked).error, /unavailable/);
  assert.equal(saveState(createDefaultState(), blocked).ok, false);
  const full = memoryStorage();
  full.setItem = () => { throw new Error('quota'); };
  assert.match(saveState(createDefaultState(), full).error, /full or blocked/);
});

test('a throwing localStorage getter is handled inside the API', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
    assert.match(loadState().error, /unavailable/);
    assert.equal(saveState(createDefaultState()).ok, false);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

test('unknown fields and prototype-pollution payloads cannot enter state', () => {
  const state = populatedState();
  const parsed = JSON.parse(JSON.stringify(state));
  Object.defineProperty(parsed, '__proto__', { value: { polluted: true }, enumerable: true });
  parsed.constructor = { prototype: { polluted: true } };
  parsed.settings.trackingUrl = 'https://example.invalid';
  Object.defineProperty(parsed.history[0], '__proto__', { value: { polluted: true }, enumerable: true });
  const sanitized = parseImport(JSON.stringify(parsed));
  assert.deepEqual(sanitized, state);
  assert.equal(Object.hasOwn(sanitized, '__proto__'), false);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(sanitized.settings.trackingUrl, undefined);
});

test('dangerous check-in keys and invalid calendar dates are rejected', () => {
  const state = createDefaultState();
  state.checkins = JSON.parse('{"__proto__":{"energy":"okay","soreness":0,"pain":false}}');
  assert.throws(() => parseImport(JSON.stringify(state)), /dates/);
  state.checkins = { '2026-02-30': { energy: 'okay', soreness: 0, pain: false } };
  assert.throws(() => parseImport(JSON.stringify(state)), /invalid date/);
});

test('completed invalid sets fail while unfinished editing values are preserved safely', () => {
  const state = populatedState();
  const set = state.draft.exercises[0].sets[0];
  set.reps = 0;
  assert.throws(() => parseImport(JSON.stringify(state)), /Completed set reps/);
  set.done = false;
  set.weightKg = '';
  set.rir = null;
  const imported = parseImport(JSON.stringify(state)).draft.exercises[0].sets[0];
  assert.deepEqual({ weight: imported.weightKg, reps: imported.reps, rir: imported.rir }, { weight: null, reps: 0, rir: null });
  set.weightKg = 1001;
  assert.throws(() => parseImport(JSON.stringify(state)), /Set weight/);
  set.weightKg = '60';
  assert.throws(() => parseImport(JSON.stringify(state)), /Set weight/);
});

test('invalid numbers, duplicate IDs and reversed workout dates are rejected', () => {
  const state = populatedState();
  state.settings.weeklyGoal = Infinity;
  assert.equal(saveState(state, memoryStorage()).ok, false);
  state.settings.weeklyGoal = 4;
  state.history.push(workout());
  assert.throws(() => parseImport(JSON.stringify(state)), /duplicate IDs/);
  state.history.pop();
  state.history[0].endedAt = '2026-11-10T13:00:00.000Z';
  assert.throws(() => parseImport(JSON.stringify(state)), /before it starts/);
  state.history[0].endedAt = '2026-02-30T13:00:00.000Z';
  assert.throws(() => parseImport(JSON.stringify(state)), /valid date/);
});

test('malformed shapes, missing fields, unsafe sizes and oversized input are rejected', () => {
  assert.throws(() => parseImport('[]'), /object/);
  assert.throws(() => parseImport('{"version":1}'), /missing/);
  assert.throws(() => parseImport('not JSON'), /valid JSON/);
  assert.throws(() => parseImport(' '.repeat(5 * 1024 * 1024 + 1)), /5 MB/);
  assert.throws(() => parseImport('é'.repeat(3 * 1024 * 1024)), /5 MB/);
  const state = populatedState();
  state.draft.exercises[0].sets = Array.from({ length: 101 }, (_, index) => ({ ...state.history[0].exercises[0].sets[0], id: `set-${index}` }));
  assert.throws(() => parseImport(JSON.stringify(state)), /at most 100/);
});

test('invalid save leaves a previous valid backup unchanged', () => {
  const storage = memoryStorage(serializeState(populatedState()));
  const before = storage.getItem(STORAGE_KEY);
  const invalidState = populatedState();
  invalidState.history[0].exercises[0].sets[0].reps = -1;
  assert.equal(saveState(invalidState, storage).ok, false);
  assert.equal(storage.getItem(STORAGE_KEY), before);
  assert.equal(storage.writes, 0);
});
