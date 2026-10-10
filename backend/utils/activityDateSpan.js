function asDate(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

// Earliest activity start and latest activity end. A missing end uses start.
// No activities, or none with a start, yields both null.
function activityDateSpan(activities) {
  let earliestStart = null;
  let latestEnd = null;
  for (const activity of activities || []) {
    const start = asDate(activity && activity.startTime);
    const end = asDate(activity && activity.endTime) || start;
    if (start && (!earliestStart || start < earliestStart)) {
      earliestStart = start;
    }
    if (end && (!latestEnd || end > latestEnd)) {
      latestEnd = end;
    }
  }
  if (!earliestStart) {
    return { earliestStart: null, latestEnd: null };
  }
  return { earliestStart, latestEnd: latestEnd || earliestStart };
}

function spansByPlanId(activities) {
  const grouped = new Map();
  for (const activity of activities || []) {
    const planId = activity && activity.planId != null ? String(activity.planId) : '';
    if (!planId) continue;
    if (!grouped.has(planId)) grouped.set(planId, []);
    grouped.get(planId).push(activity);
  }
  const spans = new Map();
  for (const [planId, rows] of grouped) {
    spans.set(planId, activityDateSpan(rows));
  }
  return spans;
}

module.exports = { activityDateSpan, spansByPlanId };
