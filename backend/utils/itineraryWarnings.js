const axios = require('axios');
const { googleMapsKey, redactKey } = require('./placeMap');

const MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json';

function instantMs(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

// Same order as the plan detail list: UTC start, missing starts last, ties keep
// the current order. The response array itself stays in stored itinerary order.
function byUtcStart(events) {
  return events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const a = instantMs(left.event.startTime);
      const b = instantMs(right.event.startTime);
      if (a == null && b == null) return left.index - right.index;
      if (a == null) return 1;
      if (b == null) return -1;
      if (a !== b) return a - b;
      return left.index - right.index;
    })
    .map((item) => item.event);
}

function placePoint(event) {
  let id = String(event && event.googlePlaceId || '').trim();
  if (id.startsWith('places/')) id = id.slice('places/'.length);
  if (id) return `place_id:${id}`;
  return String(event && event.location || '').trim();
}

function minutesFromMatrix(data) {
  if (!data || data.status !== 'OK') return null;
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const elements = rows[0] && Array.isArray(rows[0].elements) ? rows[0].elements : [];
  const element = elements[0];
  if (!element || element.status !== 'OK') return null;
  const traffic = element.duration_in_traffic && element.duration_in_traffic.value;
  const typical = element.duration && element.duration.value;
  const seconds = typeof traffic === 'number' && Number.isFinite(traffic)
    ? traffic
    : typical;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
  return {
    seconds,
    minutes: Math.round(seconds / 60),
  };
}

async function defaultGet(url, config) {
  const res = await axios.get(url, {
    params: config && config.params,
    timeout: 10000,
    validateStatus: () => true,
  });
  return { status: res.status, data: res.data };
}

async function travelEstimate(origin, destination, departMs, get) {
  const key = googleMapsKey();
  if (!key || !origin || !destination) return null;
  const params = {
    origins: origin,
    destinations: destination,
    mode: 'driving',
    key,
  };
  if (departMs != null && departMs > Date.now()) {
    params.departure_time = Math.floor(departMs / 1000);
  }
  try {
    const res = await get(MATRIX_URL, { params });
    if (!res || res.status < 200 || res.status >= 300) return null;
    return minutesFromMatrix(res.data);
  } catch (error) {
    const message = error && error.message ? error.message : 'request failed';
    console.error('Travel time lookup failed:', redactKey(message, key));
    return null;
  }
}

// Adds overlap, tightTravel, and travelMinutes on the response objects.
// Does not save the activities. A missing Maps key or a failed lookup skips
// travel warnings only.
async function attachItineraryWarnings(events, deps) {
  const list = Array.isArray(events) ? events : [];
  for (const event of list) {
    event.overlap = false;
    event.tightTravel = false;
    event.travelMinutes = null;
  }
  const ordered = byUtcStart(list);
  const get = deps && deps.get ? deps.get : defaultGet;
  const keyPresent = Boolean(googleMapsKey());
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const previous = ordered[index];
    const next = ordered[index + 1];
    const end = instantMs(previous.endTime);
    const start = instantMs(next.startTime);
    if (end == null || start == null) continue;
    if (end > start) {
      previous.overlap = true;
      next.overlap = true;
    }
    if (!keyPresent) continue;
    const origin = placePoint(previous);
    const destination = placePoint(next);
    if (!origin || !destination) continue;
    const estimate = await travelEstimate(origin, destination, end, get);
    if (!estimate) continue;
    if (start - end < estimate.seconds * 1000) {
      next.tightTravel = true;
      next.travelMinutes = estimate.minutes;
    }
  }
  return list;
}

module.exports = {
  attachItineraryWarnings,
  MATRIX_URL,
  minutesFromMatrix,
  placePoint,
  byUtcStart,
};
