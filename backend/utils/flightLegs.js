const { IANAZone } = require('luxon');

const ZONE_ERROR = 'Time zone must be an IANA name';

function hasOwn(source, key) {
  return !!source && Object.prototype.hasOwnProperty.call(source, key);
}

function isIanaName(zone) {
  if (!IANAZone.isValidZone(zone)) return false;
  if (zone === 'UTC') return true;
  // Intl accepts numeric offsets and some abbreviations. Those are not stored.
  if (!zone.includes('/')) return false;
  if (/^[+-]\d/.test(zone)) return false;
  return true;
}

function zoneNameError(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return ZONE_ERROR;
  const zone = value.trim();
  if (!zone) return null;
  if (!isIanaName(zone)) return ZONE_ERROR;
  return null;
}

function activityZoneError(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const keys = [
    'timeZone',
    'startTimeZone',
    'endTimeZone',
    'originTimeZone',
    'destinationTimeZone',
  ];
  for (const key of keys) {
    if (!hasOwn(body, key)) continue;
    const error = zoneNameError(body[key]);
    if (error) return error;
  }
  return null;
}

function readIanaZone(value) {
  const error = zoneNameError(value);
  if (error) return { error };
  if (typeof value !== 'string') return { zone: '' };
  return { zone: value.trim() };
}

function legText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function legInstant(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function legDuration(value) {
  if (value == null) return { empty: true };
  if (typeof value === 'string' && value.trim() === '') return { empty: true };
  if (typeof value !== 'number' && typeof value !== 'string') return { invalid: true };
  const number = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isFinite(number) || number < 0 || !Number.isInteger(number)) {
    return { invalid: true };
  }
  return { minutes: number };
}

function normalizeLeg(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const originTimeZone = readIanaZone(source.originTimeZone);
  if (originTimeZone.error) return { error: originTimeZone.error };
  const destinationTimeZone = readIanaZone(source.destinationTimeZone);
  if (destinationTimeZone.error) return { error: destinationTimeZone.error };
  const duration = legDuration(source.durationMinutes);
  if (duration.invalid) return { error: 'Duration must be a whole number of minutes' };
  const departure = legInstant(source.departure);
  let arrival = legInstant(source.arrival);
  let minutes = duration.empty ? null : duration.minutes;
  if (minutes != null && departure) {
    arrival = new Date(departure.getTime() + minutes * 60000);
  } else if (minutes == null && departure && arrival) {
    const span = Math.round((arrival.getTime() - departure.getTime()) / 60000);
    if (span >= 0) minutes = span;
  }
  return {
    origin: legText(source.origin),
    originTimeZone: originTimeZone.zone,
    destination: legText(source.destination),
    destinationTimeZone: destinationTimeZone.zone,
    departure,
    arrival,
    durationMinutes: minutes,
  };
}

function activityType(type) {
  return typeof type === 'string' ? type.trim().toLowerCase() : '';
}

// Flight legs own the activity span. A non-flight clears legs. An omitted legs
// array leaves stored legs alone so a time shift can omit them. An empty array
// stores no legs and does not replace the body's times.
function applyFlightLegs(body, type) {
  const source = body && typeof body === 'object' ? { ...body } : {};
  if (activityType(type) !== 'flight') {
    source.legs = [];
    return { body: source, legs: [], assignLegs: true };
  }
  if (!hasOwn(source, 'legs')) {
    return { body: source, legs: undefined, assignLegs: false };
  }
  if (!Array.isArray(source.legs)) {
    delete source.legs;
    return { body: source, legs: undefined, assignLegs: false };
  }
  const legs = [];
  for (const raw of source.legs) {
    const leg = normalizeLeg(raw);
    if (leg.error) {
      return { error: leg.error, body: source, legs: undefined, assignLegs: false };
    }
    legs.push(leg);
  }
  source.legs = legs;
  if (legs.length === 0) {
    return { body: source, legs, assignLegs: true };
  }
  const first = legs[0];
  const last = legs[legs.length - 1];
  source.startTime = first.departure;
  source.endTime = last.arrival;
  if (first.originTimeZone) {
    source.startTimeZone = first.originTimeZone;
    source.timeZone = first.originTimeZone;
  }
  if (last.destinationTimeZone) {
    source.endTimeZone = last.destinationTimeZone;
  }
  if (first.departure && last.arrival) {
    const minutes = Math.round((last.arrival.getTime() - first.departure.getTime()) / 60000);
    if (Number.isInteger(minutes) && minutes >= 0) source.durationMinutes = minutes;
    else delete source.durationMinutes;
  } else {
    source.durationMinutes = null;
  }
  return { body: source, legs, assignLegs: true };
}

module.exports = { applyFlightLegs, activityZoneError, zoneNameError };
