const { Event } = require('../models/Event');

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

async function resolveActivitySchedule({
  isCreate,
  planId,
  body,
  existingStart,
  existingEnd,
}) {
  const source = body && typeof body === 'object' ? body : {};
  const duration = hasOwn(source, 'durationMinutes')
    ? parseDurationMinutes(source.durationMinutes)
    : { empty: true };
  if (duration.invalid) {
    return { error: 'Duration must be a whole number of minutes' };
  }

  let start = null;
  if (hasOwn(source, 'startTime')) {
    const parsed = parseInstant(source.startTime);
    if (parsed.invalid) return { error: 'Start time is not a valid date' };
    start = parsed.date || null;
  } else if (!isCreate) {
    start = instant(existingStart);
  }

  if (isCreate && !start && planId) {
    start = await previousActivityInstant(planId);
  }

  let end = null;
  let minutes = duration.empty ? null : duration.minutes;
  if (minutes != null && start) {
    end = new Date(start.getTime() + minutes * 60000);
  } else {
    if (hasOwn(source, 'endTime')) {
      const parsed = parseInstant(source.endTime);
      if (parsed.invalid) return { error: 'End time is not a valid date' };
      end = parsed.date || null;
    } else if (!isCreate) {
      end = instant(existingEnd);
    }
    if (minutes == null && start && end) {
      minutes = Math.round((end.getTime() - start.getTime()) / 60000);
    }
  }

  return { startTime: start, endTime: end, durationMinutes: minutes };
}

module.exports = { resolveActivitySchedule };
