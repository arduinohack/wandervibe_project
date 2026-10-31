const MIN_CONNECTION_MS = 30 * 60 * 1000;

function instantMs(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function activityId(activity) {
  return String(activity && (activity._id || activity.id) || '').trim();
}

function activityName(activity) {
  const name = String(activity && activity.name || '').trim();
  return name || 'this activity';
}

function placeId(activity) {
  return String(activity && activity.googlePlaceId || '').trim();
}

// Activities with a real [start, end) range. Missing times are skipped.
function timedActivities(activities) {
  const list = Array.isArray(activities) ? activities : [];
  const timed = [];
  for (const activity of list) {
    const id = activityId(activity);
    const start = instantMs(activity && activity.startTime);
    const end = instantMs(activity && activity.endTime);
    if (!id || start == null || end == null || end <= start) continue;
    timed.push({
      id,
      name: activityName(activity),
      start,
      end,
      placeId: placeId(activity),
    });
  }
  timed.sort((left, right) => {
    if (left.start !== right.start) return left.start - right.start;
    return left.id.localeCompare(right.id);
  });
  return timed;
}

function warningRow(type, activity, other, message, earlierStart) {
  return {
    type,
    activityId: activity.id,
    otherActivityId: other.id,
    message,
    severity: 'warning',
    earlierStart,
    subjectStart: activity.start,
  };
}

// Advisory only. Does not call a routing API.
function buildPlanWarnings(activities) {
  const timed = timedActivities(activities);
  const warnings = [];

  for (let index = 0; index < timed.length; index += 1) {
    const left = timed[index];
    for (let next = index + 1; next < timed.length; next += 1) {
      const right = timed[next];
      if (right.start >= left.end) continue;
      const earlier = left.start <= right.start ? left : right;
      const other = earlier === left ? right : left;
      if (earlier.start < other.end && other.start < earlier.end) {
        warnings.push(warningRow(
          'overlap',
          left,
          right,
          `Overlaps with ${right.name}`,
          earlier.start,
        ));
        warnings.push(warningRow(
          'overlap',
          right,
          left,
          `Overlaps with ${left.name}`,
          earlier.start,
        ));
      }
    }
  }

  const placed = timed.filter((activity) => activity.placeId);
  for (let index = 0; index < placed.length - 1; index += 1) {
    const previous = placed[index];
    const next = placed[index + 1];
    const gap = next.start - previous.end;
    if (gap < 0 || gap >= MIN_CONNECTION_MS) continue;
    const minutes = Math.floor(gap / 60000);
    warnings.push(warningRow(
      'tight_connection',
      previous,
      next,
      `Only ${minutes} min before ${next.name} — may be tight`,
      previous.start,
    ));
    warnings.push(warningRow(
      'tight_connection',
      next,
      previous,
      `Only ${minutes} min after ${previous.name} — may be tight`,
      previous.start,
    ));
  }

  warnings.sort((left, right) => {
    if (left.earlierStart !== right.earlierStart) {
      return left.earlierStart - right.earlierStart;
    }
    if (left.subjectStart !== right.subjectStart) {
      return left.subjectStart - right.subjectStart;
    }
    const byActivity = left.activityId.localeCompare(right.activityId);
    if (byActivity) return byActivity;
    return left.type.localeCompare(right.type);
  });

  return warnings.map((row) => ({
    type: row.type,
    activityId: row.activityId,
    otherActivityId: row.otherActivityId,
    message: row.message,
    severity: row.severity,
  }));
}

module.exports = {
  MIN_CONNECTION_MS,
  buildPlanWarnings,
};
