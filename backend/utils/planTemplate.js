const DESCRIPTION_MAX = 500;
const SNAPSHOT_SKIP = new Set([
  '_id',
  'id',
  '__v',
  'createdAt',
  'updatedAt',
  'planId',
  'ownerId',
]);

function readTemplateName(body) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'name') || body.name == null) {
    return { error: 'Name is required.' };
  }
  if (typeof body.name !== 'string') return { error: 'Name must be text.' };
  const name = body.name.trim();
  if (!name) return { error: 'Name is required.' };
  return { name };
}

function readTemplateDescription(body) {
  if (!body || body.description == null) return { text: '' };
  if (typeof body.description !== 'string') {
    return { error: 'Description must be text.' };
  }
  const text = body.description.trim();
  if (text.length > DESCRIPTION_MAX) return { error: 'Description is too long.' };
  return { text };
}

function readTemplateStart(body) {
  if (!body || body.startDate == null) return { error: 'Start date is required.' };
  if (typeof body.startDate !== 'string') return { error: 'Enter a valid date.' };
  const text = body.startDate.trim();
  if (!text) return { error: 'Start date is required.' };
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (day) {
    const year = Number(day[1]);
    const month = Number(day[2]);
    const date = Number(day[3]);
    const utc = Date.UTC(year, month - 1, date);
    const check = new Date(utc);
    if (
      check.getUTCFullYear() !== year
      || check.getUTCMonth() !== month - 1
      || check.getUTCDate() !== date
    ) {
      return { error: 'Enter a valid date.' };
    }
    return { date: check };
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return { error: 'Enter a valid date.' };
  return { date: parsed };
}

function asDate(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function utcDayStart(value) {
  const date = asDate(value);
  if (!date) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function dayShiftMs(anchor, target) {
  const from = utcDayStart(anchor);
  const to = utcDayStart(target);
  if (from == null || to == null) return 0;
  return to - from;
}

function shiftInstant(value, delta) {
  const date = asDate(value);
  if (!date) return null;
  return new Date(date.getTime() + (delta || 0));
}

function snapshotValue(value) {
  if (value == null) return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(snapshotValue);
  if (typeof value === 'object') {
    const next = {};
    for (const [key, inner] of Object.entries(value)) {
      if (SNAPSHOT_SKIP.has(key)) continue;
      next[key] = snapshotValue(inner);
    }
    return next;
  }
  return value;
}

function activitySnapshot(source) {
  return snapshotValue(source);
}

function earliestActivityStart(activities) {
  let earliest = null;
  for (const activity of activities || []) {
    const start = asDate(activity && activity.startTime);
    if (!start) continue;
    if (!earliest || start < earliest) earliest = start;
  }
  return earliest;
}

function assignShift(target, key, delta) {
  if (target[key] == null || target[key] === '') return;
  const next = shiftInstant(target[key], delta);
  if (next) target[key] = next;
}

function shiftSnapshot(snapshot, delta) {
  const next = snapshotValue(snapshot);
  assignShift(next, 'startTime', delta);
  assignShift(next, 'endTime', delta);
  if (Array.isArray(next.legs)) {
    next.legs = next.legs.map((leg) => {
      const copy = snapshotValue(leg);
      assignShift(copy, 'departure', delta);
      assignShift(copy, 'arrival', delta);
      return copy;
    });
  }
  if (Array.isArray(next.subEvents)) {
    next.subEvents = next.subEvents.map((sub) => shiftSnapshot(sub, delta));
  }
  return next;
}

function templateFieldsFromPlan(source) {
  return {
    type: source.type,
    destination: source.destination || '',
    location: source.location || '',
    timeZone: source.timeZone || '',
    budget: typeof source.budget === 'number' ? source.budget : 0,
    hiddenFields: Array.isArray(source.hiddenFields) ? [...source.hiddenFields] : [],
    planningState: source.planningState || 'initial',
    autoCalculateStartDate: source.autoCalculateStartDate === true,
    autoCalculateEndDate: source.autoCalculateEndDate === true,
    startDate: source.startDate || null,
    endDate: source.endDate || null,
  };
}

// Move every activity by whole UTC days so the earliest start lands on [target].
// Plan dates move by that same gap. Clock times stay put.
function shiftedTemplatePlan(template, targetDate) {
  const activities = Array.isArray(template.activities) ? template.activities : [];
  const anchor = earliestActivityStart(activities) || template.startDate || null;
  const delta = anchor ? dayShiftMs(anchor, targetDate) : 0;
  let startDate = template.startDate ? shiftInstant(template.startDate, delta) : null;
  const endDate = template.endDate ? shiftInstant(template.endDate, delta) : null;
  if (!startDate) {
    const day = utcDayStart(targetDate);
    startDate = day == null ? null : new Date(day);
  }
  return {
    startDate,
    endDate,
    activities: activities.map((activity) => shiftSnapshot(activity, delta)),
  };
}

module.exports = {
  DESCRIPTION_MAX,
  readTemplateName,
  readTemplateDescription,
  readTemplateStart,
  activitySnapshot,
  templateFieldsFromPlan,
  shiftedTemplatePlan,
};
