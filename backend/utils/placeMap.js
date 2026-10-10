const axios = require('axios');
const logger = require('./logger');

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const STATIC_URL = 'https://maps.googleapis.com/maps/api/staticmap';
const MAP_ZOOM = '15';
const MAP_SIZE = '600x400';
const BODY_LOG_CHARS = 180;

function googleMapsKey() {
  return String(process.env.GOOGLE_MAPS_API_KEY || '').trim();
}

function redactKey(text, key) {
  const raw = String(text == null ? '' : text);
  if (!key) return raw;
  return raw.split(key).join('[redacted]');
}

function bodyText(body) {
  if (body == null) return '';
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (body instanceof ArrayBuffer) return Buffer.from(body).toString('utf8');
  return String(body);
}

function isPng(body, contentType) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('image/png') && body && body.length) return true;
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body || []);
  return buf.length >= 8
    && buf[0] === 0x89
    && buf[1] === 0x50
    && buf[2] === 0x4e
    && buf[3] === 0x47;
}

function googleErrorMessage(text) {
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const msg = data.error_message || data.errorMessage || data.message;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
    if (data.error && typeof data.error.message === 'string' && data.error.message.trim()) {
      return data.error.message.trim();
    }
    if (typeof data.status === 'string' && data.status.trim()) return data.status.trim();
    return null;
  } catch (_) {
    return null;
  }
}

function firstLatLng(text) {
  try {
    const data = JSON.parse(text);
    const loc = data && data.results && data.results[0]
      && data.results[0].geometry && data.results[0].geometry.location;
    const lat = loc && loc.lat;
    const lng = loc && loc.lng;
    if (typeof lat === 'number' && typeof lng === 'number') return { lat, lng };
    return null;
  } catch (_) {
    return null;
  }
}

function logGoogleResponse(label, status, body, key) {
  const snippet = redactKey(bodyText(body), key).slice(0, BODY_LOG_CHARS);
  logger.info(`Google ${label} status ${status}`, {
    event: 'GoogleStaticMap',
    context: { status, body: snippet },
  });
}

function geocodeUrl(placeId, key) {
  const params = new URLSearchParams({ place_id: placeId, key });
  return `${GEOCODE_URL}?${params.toString()}`;
}

function staticMapUrl(lat, lng, key) {
  const center = `${lat},${lng}`;
  const params = new URLSearchParams({
    center,
    markers: `color:red|${center}`,
    zoom: MAP_ZOOM,
    size: MAP_SIZE,
    format: 'png',
    key,
  });
  return `${STATIC_URL}?${params.toString()}`;
}

async function defaultGet(url) {
  const res = await axios.get(url, {
    timeout: 15000,
    responseType: 'arraybuffer',
    validateStatus: () => true,
  });
  return {
    status: res.status,
    contentType: String((res.headers && res.headers['content-type']) || ''),
    body: Buffer.from(res.data || []),
  };
}

async function requestGoogle(fetchUrl, url, label, key) {
  try {
    const res = await fetchUrl(url);
    logGoogleResponse(label, res && res.status, res && res.body, key);
    return res;
  } catch (err) {
    const status = (err.response && err.response.status) || 0;
    const errBody = (err.response && err.response.data) || err.message || '';
    logGoogleResponse(label, status, errBody, key);
    const text = bodyText(errBody);
    return {
      status,
      body: errBody,
      error: googleErrorMessage(text) || 'Could not load map',
    };
  }
}

// PNG of a Google Map around a Place ID. Zoom 15 is neighborhood scale.
async function fetchPlaceMapPng(placeId, { get, getStatic } = {}) {
  const key = googleMapsKey();
  if (!key) {
    return { status: 503, msg: 'Google Maps is not configured' };
  }
  const id = String(placeId || '').trim();
  if (!id) {
    return { status: 400, msg: 'Missing placeId' };
  }

  const fetchUrl = get || getStatic || defaultGet;
  const geoRes = await requestGoogle(fetchUrl, geocodeUrl(id, key), 'Geocode', key);
  if (geoRes && geoRes.error) {
    return { status: 502, msg: geoRes.error };
  }
  const geoText = bodyText(geoRes && geoRes.body);
  const location = firstLatLng(geoText);
  if (!location) {
    return { status: 502, msg: googleErrorMessage(geoText) || 'Could not load map' };
  }

  const mapRes = await requestGoogle(
    fetchUrl,
    staticMapUrl(location.lat, location.lng, key),
    'Static Map',
    key,
  );
  if (mapRes && mapRes.error) {
    return { status: 502, msg: mapRes.error };
  }

  const status = mapRes && mapRes.status;
  const body = mapRes && mapRes.body;
  if (isPng(body, mapRes && mapRes.contentType)) {
    return { status: 200, png: Buffer.from(body), contentType: 'image/png' };
  }

  const text = bodyText(body);
  const googleError = googleErrorMessage(text);
  if (googleError) {
    return { status: 502, msg: googleError };
  }
  return { status: 502, msg: 'Could not load map' };
}

module.exports = {
  fetchPlaceMapPng,
  googleMapsKey,
  geocodeUrl,
  staticMapUrl,
  redactKey,
  GEOCODE_URL,
  STATIC_URL,
  MAP_ZOOM,
  MAP_SIZE,
  BODY_LOG_CHARS,
};
