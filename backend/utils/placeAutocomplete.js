const axios = require('axios');
const { googleMapsKey, redactKey } = require('./placeMap');

const AUTOCOMPLETE_URL = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
const MAX_RESULTS = 5;

function autocompleteUrl(query, key) {
  const params = new URLSearchParams({ input: query, key });
  return `${AUTOCOMPLETE_URL}?${params.toString()}`;
}

function bodyText(body) {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(body);
  } catch (_) {
    return '';
  }
}

function googleMessage(data) {
  if (!data || typeof data !== 'object') return '';
  const msg = data.error_message || data.errorMessage || data.message;
  if (typeof msg === 'string' && msg.trim()) return msg.trim();
  if (data.error && typeof data.error.message === 'string' && data.error.message.trim()) {
    return data.error.message.trim();
  }
  if (typeof data.status === 'string' && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    return data.status.trim();
  }
  return '';
}

function suggestionFromPrediction(prediction) {
  if (!prediction || typeof prediction !== 'object') return null;
  const placeId = String(prediction.place_id || '').trim();
  if (!placeId) return null;
  const formatting = prediction.structured_formatting || {};
  const main = String(formatting.main_text || '').trim();
  const secondary = String(formatting.secondary_text || '').trim();
  const description = String(prediction.description || '').trim();
  const name = main || description;
  if (!name) return null;
  return {
    placeId,
    name,
    address: secondary,
  };
}

function placesFromPayload(payload) {
  let data = payload;
  if (typeof payload === 'string') {
    try {
      data = JSON.parse(payload);
    } catch (_) {
      return { error: 'Could not search places' };
    }
  }
  if (!data || typeof data !== 'object') {
    return { error: 'Could not search places' };
  }
  const status = typeof data.status === 'string' ? data.status : '';
  if (status && status !== 'OK' && status !== 'ZERO_RESULTS') {
    return { error: googleMessage(data) || 'Could not search places' };
  }
  const predictions = Array.isArray(data.predictions) ? data.predictions : [];
  const places = [];
  for (const prediction of predictions) {
    const row = suggestionFromPrediction(prediction);
    if (!row) continue;
    places.push(row);
    if (places.length >= MAX_RESULTS) break;
  }
  return { places };
}

async function defaultGet(url) {
  const res = await axios.get(url, {
    timeout: 15000,
    validateStatus: () => true,
  });
  return {
    status: res.status,
    body: res.data,
  };
}

// Google Places Autocomplete. Returns a short list of placeId, name, and address.
async function searchPlaces(query, { get } = {}) {
  const key = googleMapsKey();
  if (!key) {
    return { status: 503, msg: 'Google Maps is not configured' };
  }
  const q = String(query || '').trim();
  if (!q) {
    return { status: 400, msg: 'Query is required' };
  }

  const fetchUrl = get || defaultGet;
  let res;
  try {
    res = await fetchUrl(autocompleteUrl(q, key));
  } catch (_) {
    return { status: 502, msg: 'Could not search places' };
  }

  const parsed = placesFromPayload(res && res.body);
  if (parsed.error || !res || res.status < 200 || res.status >= 300) {
    const msg = redactKey(parsed.error || 'Could not search places', key);
    return { status: 502, msg };
  }
  return { status: 200, places: parsed.places };
}

module.exports = {
  searchPlaces,
  autocompleteUrl,
  placesFromPayload,
  AUTOCOMPLETE_URL,
  MAX_RESULTS,
};
