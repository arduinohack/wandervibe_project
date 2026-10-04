const { Event } = require('../models/Event');
const Plan = require('../models/Plan');

function hasOwn(source, key) {
  return !!source && Object.prototype.hasOwnProperty.call(source, key);
}

function instant(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseInstant(value) {
  if (value == null) return { empty: true };
  if (typeof value === 'string' && value.trim() === '') return { empty: true };
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? { invalid: true } : { date: value };
  }
  if (typeof value === 'number' || typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? { invalid: true } : { date };
  }
  return { invalid: true };
}

function parseDurationMinutes(value) {
  if (value == null) return { empty: true };
  if (typeof value === 'string' && value.trim() === '') return { empty: true };
  if (typeof value !== 'number' && typeof value !== 'string') return { invalid: true };
  const number = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isFinite(number) || number < 0 || !Number.isInteger(number)) {
    return { invalid: true };
  }
  return { minutes: number };
}

function compareItinerary(a, b) {
  const aStart = instant(a.startTime);
  const bStart = instant(b.startTime);
  if (!aStart && !bStart) return 0;
  if (!aStart) return 1;
  if (!bStart) return -1;
  return aStart.getTime() - bStart.getTime();
}

function compareStoredOrder(a, b) {
  const byNum = (Number(a.eventNum) || 0) - (Number(b.eventNum) || 0);
  if (byNum !== 0) return byNum;
  const byStart = compareItinerary(a, b);
  if (byStart !== 0) return byStart;
  return String(a._id).localeCompare(String(b._id));
}

async function previousActivityInstant(planId) {
  const rows = await Event.find({ planId }).select('startTime endTime').lean();
  rows.sort(compareItinerary);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const end = instant(rows[i].endTime);
    const start = instant(rows[i].startTime);
    if (end) return end;
    if (start) return start;
  }
  return null;
}

// The row just before excludeId in stored itinerary order. Its end, or its
// start when the end is missing. The first row has none.
async function previousActivityChainStart(planId, excludeId) {
  if (!planId || excludeId == null) return null;
  const rows = await Event.find({ planId }).select('_id eventNum startTime endTime').lean();
  rows.sort(compareStoredOrder);
  const index = rows.findIndex((row) => String(row._id) === String(excludeId));
  if (index <= 0) return null;
  const previous = rows[index - 1];
  return instant(previous.endTime) || instant(previous.startTime);
}

async function resolveActivitySchedule({
  isCreate,
  planId,
  body,
  existingStart,
  existingEnd,
  excludeId,
  keepEmptyStart,
}) {
  const source = body && typeof body === 'object' ? body : {};
  const duration = hasOwn(source, 'durationMinutes')
    ? parseDurationMinutes(source.durationMinutes)
    : { empty: true };
  if (duration.invalid) {
    return { error: 'Duration must be a whole number of minutes' };
  }

  let start = null;
  let startExplicitlyEmpty = false;
  if (hasOwn(source, 'startTime')) {
    const parsed = parseInstant(source.startTime);
    if (parsed.invalid) return { error: 'Start time is not a valid date' };
    start = parsed.date || null;
    startExplicitlyEmpty = start == null;
  } else if (!isCreate) {
    start = instant(existingStart);
  }

  if (isCreate && !start && planId && !keepEmptyStart) {
    start = await previousActivityInstant(planId);
  } else if (!isCreate && startExplicitlyEmpty && planId) {
    start = await previousActivityChainStart(planId, excludeId);
  }

  let minutes = duration.empty ? null : duration.minutes;
  let end = null;
  if (hasOwn(source, 'endTime')) {
    const parsed = parseInstant(source.endTime);
    if (parsed.invalid) return { error: 'End time is not a valid date' };
    end = parsed.date || null;
  } else if (!isCreate) {
    end = instant(existingEnd);
  } else if (minutes != null && start) {
    end = new Date(start.getTime() + minutes * 60000);
  }

  if (minutes == null && start && end) {
    minutes = Math.round((end.getTime() - start.getTime()) / 60000);
  }

  return { startTime: start, endTime: end, durationMinutes: minutes };
}

async function defaultActivityTimeZone(body, planId) {
  const raw = body && typeof body.timeZone === 'string' ? body.timeZone.trim() : '';
  if (raw) return raw;
  if (!planId) return '';
  const plan = await Plan.findById(planId).select('timeZone').lean();
  return plan && typeof plan.timeZone === 'string' ? plan.timeZone.trim() : '';
}

function zoneText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function ownZone(source, key) {
  if (!hasOwn(source, key)) return '';
  return zoneText(source[key]);
}

// startTimeZone is the clock. endTimeZone stays independent when it is already
// stored. A blank end zone on create becomes the start zone. Legacy
// originTimeZone and destinationTimeZone fill the new fields when those are empty.
async function resolveActivityZones({ isCreate, planId, body, existing }) {
  const source = body && typeof body === 'object' ? body : {};
  const stored = existing && typeof existing === 'object' ? existing : {};

  let start = ownZone(source, 'startTimeZone');
  if (!start) start = ownZone(source, 'originTimeZone');
  if (!start && !isCreate) {
    start = zoneText(stored.startTimeZone) || zoneText(stored.originTimeZone);
  }
  if (!start) start = ownZone(source, 'timeZone');
  if (!start && !isCreate) start = zoneText(stored.timeZone);
  if (!start && isCreate) {
    start = await defaultActivityTimeZone({ timeZone: '' }, planId);
  }

  let end = ownZone(source, 'endTimeZone');
  if (!end) end = ownZone(source, 'destinationTimeZone');
  if (!end && !isCreate) {
    end = zoneText(stored.endTimeZone) || zoneText(stored.destinationTimeZone);
  }
  if (!end) end = start;

  return {
    startTimeZone: start,
    endTimeZone: end,
    timeZone: start,
  };
}

module.exports = {
  resolveActivitySchedule,
  defaultActivityTimeZone,
  resolveActivityZones,
  compareStoredOrder,
};
