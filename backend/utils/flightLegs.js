function hasOwn(source, key) {
  return !!source && Object.prototype.hasOwnProperty.call(source, key);
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

function normalizeLeg(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    origin: legText(source.origin),
    destination: legText(source.destination),
    departure: legInstant(source.departure),
    arrival: legInstant(source.arrival),
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
  const legs = source.legs.map(normalizeLeg);
  source.legs = legs;
  if (legs.length === 0) {
    return { body: source, legs, assignLegs: true };
  }
  const first = legs[0];
  const last = legs[legs.length - 1];
  source.startTime = first.departure;
  source.endTime = last.arrival;
  if (first.departure && last.arrival) {
    const minutes = Math.round((last.arrival.getTime() - first.departure.getTime()) / 60000);
    if (Number.isInteger(minutes) && minutes >= 0) source.durationMinutes = minutes;
    else delete source.durationMinutes;
  } else {
    source.durationMinutes = null;
  }
  return { body: source, legs, assignLegs: true };
}

module.exports = { applyFlightLegs };
