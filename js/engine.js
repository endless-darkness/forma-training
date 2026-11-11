/** Explainable starting rules. They do not predict a maximum rate of muscle growth. */

export function isValidSet(set) {
  return Boolean(set)
    && Number.isFinite(set.weightKg) && set.weightKg >= 0 && set.weightKg <= 1000
    && Number.isInteger(set.reps) && set.reps >= 1 && set.reps <= 100
    && Number.isInteger(set.rir) && set.rir >= 0 && set.rir <= 10;
}

export function recommend(exercise, history) {
  const exerciseId = exercise.exerciseId ?? exercise.id;
  const exposures = finishedSessions(history).flatMap(session => {
    const matching = array(session.exercises).filter(log => log.exerciseId === exerciseId);
    // An empty, incomplete, or invalid latest exposure stays in this list. It must
    // block an increase instead of allowing the engine to skip back to older wins.
    return matching.length ? [matching.flatMap(log => array(log.sets)).filter(set => !set?.warmup)] : [];
  });
  let lastLoad = null;
  for (const sets of exposures) {
    const valid = sets.filter(isWorkingSet);
    if (valid.length) {
      lastLoad = Math.min(...valid.map(set => set.weightKg));
      break;
    }
  }

  if (lastLoad === null) {
    return {
      title: 'Find your starting load',
      detail: `Choose a manageable load for ${exercise.repMin}–${exercise.repMax} reps, leaving about 2 reps in reserve. Log your working sets to establish a baseline.`,
      weightKg: null,
      increase: false,
    };
  }
  if (lastLoad === 0) {
    return {
      title: 'Build consistent reps',
      detail: 'Your last load was recorded as bodyweight. Keep the movement consistent and build reps before choosing an added load yourself.',
      weightKg: 0,
      increase: false,
    };
  }

  const latest = qualifyingLoad(exposures[0], exercise);
  const previous = qualifyingLoad(exposures[1], exercise);
  if (latest !== null && previous !== null && Math.abs(latest - previous) < 0.0001
      && Number.isFinite(exercise.incrementKg) && exercise.incrementKg > 0
      && latest + exercise.incrementKg <= 1000) {
    return {
      title: 'Ready for a small increase',
      detail: 'Your last two sessions reached the top of the rep range on every working set at the same load, with at least 1 rep in reserve. Try the suggested load if warm-ups feel comfortable. You can edit it to match your equipment.',
      weightKg: Math.round((latest + exercise.incrementKg) * 1000000) / 1000000,
      increase: true,
    };
  }
  return {
    title: 'Build reps at this load',
    detail: `Build toward ${exercise.repMax} reps with 1–2 reps in reserve. An increase needs two complete sessions at the same load. If your last sets used different loads, this suggests the lightest one.`,
    weightKg: lastLoad,
    increase: false,
  };
}

/** Today and the preceding six local calendar dates; primary muscle only. */
export function weeklyVolume(history, now = new Date()) {
  const counts = {};
  for (const session of recentSessions(history, now)) {
    for (const log of array(session.exercises)) {
      if (typeof log.muscle !== 'string' || !log.muscle) continue;
      const count = array(log.sets).filter(isWorkingSet).length;
      // defineProperty also handles imported keys such as "__proto__" safely.
      const previous = Object.hasOwn(counts, log.muscle) ? counts[log.muscle] : 0;
      Object.defineProperty(counts, log.muscle, { value: previous + count, enumerable: true, writable: true, configurable: true });
    }
  }
  return counts;
}

/** Workout totals from the same seven-calendar-day window as weeklyVolume. */
export function trainingStats(history, now = new Date()) {
  // Preserve empty exposures in history for progression, but do not present an
  // unlogged session as completed training or credit its elapsed time to goals.
  const recent = recentSessions(history, now).filter(session =>
    array(session.exercises).some(log => array(log.sets).some(isWorkingSet))
  );
  const stats = { sessions: recent.length, sets: 0, volumeKg: 0, minutes: 0 };
  for (const session of recent) {
    stats.minutes += (timestamp(session.endedAt) - timestamp(session.startedAt)) / 60000;
    for (const log of array(session.exercises)) {
      for (const set of array(log.sets).filter(isWorkingSet)) {
        stats.sets += 1;
        stats.volumeKg += set.weightKg * set.reps;
      }
    }
  }
  stats.volumeKg = Math.round(stats.volumeKg * 1000) / 1000;
  stats.minutes = Math.round(stats.minutes);
  return stats;
}

/** A manual check-in provides context, not a measured recovery or injury score. */
export function sessionAdvice(checkin) {
  if (!checkin || !isCurrentCheckin(checkin)) {
    return { title: 'Make a quick check-in', detail: 'Tell us how you feel today. Your recent performance and warm-up sets help guide the session.', tone: 'neutral' };
  }
  if (checkin.hasPain === true || checkin.pain === true) {
    return { title: 'Pause painful movements', detail: 'You reported pain. Stop the movement that hurts and choose a pain-free alternative or rest. Seek qualified advice if pain persists or is concerning.', tone: 'caution' };
  }
  const energy = String(checkin.energy ?? '').toLowerCase();
  const substantialSoreness = Number.isFinite(checkin.soreness) && checkin.soreness >= 3;
  if (energy === 'low' || substantialSoreness) {
    return { title: 'Consider an easier session', detail: 'You reported low energy or substantial soreness. Warm up and reassess; you can choose fewer working sets or another rest day. Your plan stays under your control.', tone: 'caution' };
  }
  if (energy === 'great' || energy === 'okay') {
    return { title: 'Follow your usual plan', detail: 'Use your planned loads and adjust to how warm-ups feel. Feeling good alone does not require adding weight or sets.', tone: 'good' };
  }
  return { title: 'Use your warm-up as a guide', detail: 'Start with your usual plan, check your technique and effort, and adjust as needed.', tone: 'neutral' };
}

function array(value) { return Array.isArray(value) ? value : []; }
function isWorkingSet(set) { return set?.done === true && !set.warmup && isValidSet(set); }
function timestamp(value) {
  if (!(typeof value === 'string' || value instanceof Date)) return NaN;
  return new Date(value).getTime();
}

function qualifyingLoad(sets, exercise) {
  if (!Array.isArray(sets) || !Number.isInteger(exercise.targetSets) || exercise.targetSets < 1
      || sets.length < exercise.targetSets || !Number.isInteger(exercise.repMax)
      || !isWorkingSet(sets[0]) || sets[0].weightKg <= 0) return null;
  const load = sets[0].weightKg;
  return sets.every(set => isWorkingSet(set) && set.reps >= exercise.repMax && set.rir >= 1 && Math.abs(set.weightKg - load) < 0.0001) ? load : null;
}

function finishedSessions(history, now = new Date()) {
  const latest = new Date(now).getTime();
  if (!Number.isFinite(latest)) return [];
  const sorted = array(history).filter(session => {
    const start = timestamp(session?.startedAt);
    const end = timestamp(session?.endedAt);
    return Number.isFinite(start) && Number.isFinite(end) && end >= start && end <= latest;
  }).sort((a, b) => timestamp(b.endedAt) - timestamp(a.endedAt)
    || timestamp(b.startedAt) - timestamp(a.startedAt)
    || String(a.id).localeCompare(String(b.id)));
  const seen = new Set();
  return sorted.filter(session => {
    if (typeof session.id !== 'string' || !session.id) return true;
    if (seen.has(session.id)) return false;
    seen.add(session.id);
    return true;
  });
}

function recentSessions(history, now) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);
  return finishedSessions(history, now).filter(session => timestamp(session.startedAt) >= start.getTime());
}

function isCurrentCheckin(checkin) {
  // Callers may pass a fresh unsaved check-in. If a date is supplied, enforce today.
  if (checkin.date == null) return true;
  const day = new Date(checkin.date);
  const now = new Date();
  return Number.isFinite(day.getTime()) && day <= now
    && day.getFullYear() === now.getFullYear() && day.getMonth() === now.getMonth() && day.getDate() === now.getDate();
}
