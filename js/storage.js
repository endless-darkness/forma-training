/** Local-only, versioned workout storage. No network requests are made here. */
export const STORAGE_KEY = 'forma.workouts.v1';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_HISTORY = 3000;
const MAX_CHECKINS = 10000;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export function createDefaultState() {
  return {
    version: 1,
    settings: { unit: 'lb', restSeconds: 120, weeklyGoal: 4 },
    history: [],
    draft: null,
    checkins: {},
  };
}

function invalid(message) {
  throw new Error(message);
}

function record(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${label} must be an object.`);
  }
  return value;
}

function field(object, key, label) {
  if (!own(object, key)) invalid(`${label} is missing.`);
  return object[key];
}

function text(value, label, maximum, allowEmpty = false, multiline = false) {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim())) {
    invalid(`${label} must be ${allowEmpty ? 'text' : 'nonempty text'} of at most ${maximum} characters.`);
  }
  const forbidden = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
  if (forbidden.test(value)) invalid(`${label} contains unsupported characters.`);
  return value;
}

function number(value, label, minimum, maximum, integer = true) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    invalid(`${label} must be ${integer ? 'a whole number' : 'a number'} between ${minimum} and ${maximum}.`);
  }
  return value;
}

function editableNumber(value, label, maximum) {
  if (value === null || value === '') return null;
  return number(value, label, -maximum, maximum, false);
}

function boolean(value, label) {
  if (typeof value !== 'boolean') invalid(`${label} must be true or false.`);
  return value;
}

function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) invalid(`${label} is not supported.`);
  return value;
}

function array(value, label, maximum) {
  if (!Array.isArray(value) || value.length > maximum) invalid(`${label} must contain at most ${maximum} items.`);
  return value;
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    invalid(`${label} must be a valid UTC date and time.`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) invalid(`${label} must be a valid UTC date and time.`);
  const canonical = date.toISOString();
  if (canonical.slice(0, 19) !== value.slice(0, 19) || date.getUTCFullYear() < 1900 || date.getUTCFullYear() > 2200) {
    invalid(`${label} must be a valid date between 1900 and 2200.`);
  }
  return canonical;
}

function dateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid('Check-in dates must use YYYY-MM-DD.');
  const date = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || date.getUTCFullYear() < 1900 || date.getUTCFullYear() > 2200) {
    invalid('A check-in contains an invalid date.');
  }
  return value;
}

function unique(items, label) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) invalid(`${label} contain duplicate IDs.`);
    seen.add(item.id);
  }
  return items;
}

function sanitizeSet(value) {
  const item = record(value, 'Set');
  const done = boolean(field(item, 'done', 'Set completion'), 'Set completion');
  const weight = field(item, 'weightKg', 'Set weight');
  const reps = field(item, 'reps', 'Set reps');
  const rir = field(item, 'rir', 'Set effort');
  return {
    id: text(field(item, 'id', 'Set ID'), 'Set ID', 128),
    weightKg: done ? number(weight, 'Completed set weight', 0, 1000, false) : editableNumber(weight, 'Set weight', 1000),
    reps: done ? number(reps, 'Completed set reps', 1, 100) : editableNumber(reps, 'Set reps', 100),
    rir: done ? number(rir, 'Completed set effort', 0, 10) : editableNumber(rir, 'Set effort', 10),
    warmup: boolean(field(item, 'warmup', 'Warm-up setting'), 'Warm-up setting'),
    done,
  };
}

function sanitizeExercise(value) {
  const item = record(value, 'Exercise');
  const repMin = number(field(item, 'repMin', 'Minimum reps'), 'Minimum reps', 1, 100);
  const repMax = number(field(item, 'repMax', 'Maximum reps'), 'Maximum reps', repMin, 100);
  const inputSets = array(field(item, 'sets', 'Exercise sets'), 'Exercise sets', 100);
  const sets = [];
  for (let index = 0; index < inputSets.length; index += 1) sets.push(sanitizeSet(inputSets[index]));
  return {
    id: text(field(item, 'id', 'Exercise ID'), 'Exercise ID', 128),
    exerciseId: text(field(item, 'exerciseId', 'Exercise reference'), 'Exercise reference', 128),
    name: text(field(item, 'name', 'Exercise name'), 'Exercise name', 200),
    muscle: text(field(item, 'muscle', 'Muscle group'), 'Muscle group', 80),
    repMin,
    repMax,
    targetSets: number(field(item, 'targetSets', 'Target sets'), 'Target sets', 1, 100),
    restSeconds: number(field(item, 'restSeconds', 'Exercise rest time'), 'Exercise rest time', 0, 3600),
    incrementKg: number(field(item, 'incrementKg', 'Weight increment'), 'Weight increment', 0.001, 100, false),
    sets: unique(sets, 'Exercise sets'),
  };
}

function sanitizeSession(value, isDraft) {
  const item = record(value, 'Workout');
  const startedAt = timestamp(field(item, 'startedAt', 'Workout start time'), 'Workout start time');
  const rawEnd = field(item, 'endedAt', 'Workout end time');
  let endedAt = null;
  if (isDraft) {
    if (rawEnd !== null) invalid('An active workout cannot have an end time.');
  } else {
    endedAt = timestamp(rawEnd, 'Workout end time');
    if (endedAt < startedAt) invalid('A workout cannot end before it starts.');
  }
  const inputExercises = array(field(item, 'exercises', 'Workout exercises'), 'Workout exercises', 40);
  const exercises = [];
  for (let index = 0; index < inputExercises.length; index += 1) exercises.push(sanitizeExercise(inputExercises[index]));
  return {
    id: text(field(item, 'id', 'Workout ID'), 'Workout ID', 128),
    templateId: text(field(item, 'templateId', 'Workout template'), 'Workout template', 128),
    name: text(field(item, 'name', 'Workout name'), 'Workout name', 200),
    startedAt,
    endedAt,
    exercises: unique(exercises, 'Workout exercises'),
    notes: text(field(item, 'notes', 'Workout notes'), 'Workout notes', 4000, true, true),
  };
}

function sanitizeState(value) {
  const input = record(value, 'Backup');
  if (field(input, 'version', 'Backup version') !== 1) invalid('This backup version is not supported.');
  const settings = record(field(input, 'settings', 'Settings'), 'Settings');
  const inputHistory = array(field(input, 'history', 'Workout history'), 'Workout history', MAX_HISTORY);
  const history = [];
  for (let index = 0; index < inputHistory.length; index += 1) history.push(sanitizeSession(inputHistory[index], false));
  unique(history, 'Workout history');
  const rawDraft = field(input, 'draft', 'Active workout');
  const draft = rawDraft === null ? null : sanitizeSession(rawDraft, true);
  if (draft && history.some((session) => session.id === draft.id)) invalid('The active workout is already in history.');
  const inputCheckins = record(field(input, 'checkins', 'Check-ins'), 'Check-ins');
  const keys = Object.keys(inputCheckins);
  if (keys.length > MAX_CHECKINS) invalid(`A backup may contain at most ${MAX_CHECKINS} check-ins.`);
  const checkins = {};
  for (const key of keys) {
    dateKey(key);
    const checkin = record(inputCheckins[key], 'Check-in');
    checkins[key] = {
      energy: oneOf(field(checkin, 'energy', 'Energy level'), ['low', 'okay', 'great'], 'Energy level'),
      soreness: number(field(checkin, 'soreness', 'Soreness level'), 'Soreness level', 0, 3),
      pain: boolean(field(checkin, 'pain', 'Pain setting'), 'Pain setting'),
    };
  }
  return {
    version: 1,
    settings: {
      unit: oneOf(field(settings, 'unit', 'Weight unit'), ['lb', 'kg'], 'Weight unit'),
      restSeconds: number(field(settings, 'restSeconds', 'Rest time'), 'Rest time', 0, 3600),
      weeklyGoal: number(field(settings, 'weeklyGoal', 'Weekly workout goal'), 'Weekly workout goal', 1, 7),
    },
    history,
    draft,
    checkins,
  };
}

function checkSize(value) {
  if (value.length > MAX_BYTES || new TextEncoder().encode(value).byteLength > MAX_BYTES) {
    invalid('The backup is too large. The limit is 5 MB.');
  }
}

export function parseImport(value) {
  if (typeof value !== 'string') invalid('Choose a JSON backup file.');
  checkSize(value);
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    invalid('The backup is not valid JSON.');
  }
  return sanitizeState(parsed);
}

export function serializeState(state) {
  const serialized = JSON.stringify(sanitizeState(state), null, 2);
  checkSize(serialized);
  return serialized;
}

function resolveStorage(storage) {
  // Accessing the browser's localStorage getter can itself throw in private or restricted contexts.
  const resolved = storage === undefined ? globalThis.localStorage : storage;
  if (!resolved || typeof resolved.getItem !== 'function' || typeof resolved.setItem !== 'function') {
    invalid('Local storage is unavailable.');
  }
  return resolved;
}

export function loadState(storage) {
  let stored;
  try {
    stored = resolveStorage(storage).getItem(STORAGE_KEY);
  } catch {
    return { state: createDefaultState(), error: 'Local storage is unavailable. Changes cannot be saved in this browser.' };
  }
  if (stored === null) return { state: createDefaultState(), error: null };
  try {
    return { state: parseImport(stored), error: null };
  } catch (error) {
    return {
      state: createDefaultState(),
      error: `Saved data could not be loaded and has been preserved. ${error.message}`,
    };
  }
}

export function saveState(state, storage) {
  let serialized;
  try {
    serialized = serializeState(state);
  } catch (error) {
    return { ok: false, error: `Changes could not be saved. ${error.message}` };
  }
  let resolved;
  let stored;
  try {
    resolved = resolveStorage(storage);
    stored = resolved.getItem(STORAGE_KEY);
  } catch {
    return { ok: false, error: 'Local storage is unavailable. Export a backup to keep your changes.' };
  }
  if (stored !== null) {
    try {
      parseImport(stored);
    } catch {
      return { ok: false, error: 'Unreadable saved data has been preserved. Restore a backup or explicitly reset saved data before saving.' };
    }
  }
  try {
    resolved.setItem(STORAGE_KEY, serialized);
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: 'The browser could not save your changes. Storage may be full or blocked; export a backup to keep them.' };
  }
}
