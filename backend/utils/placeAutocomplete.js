const axios = require('axios');
const { googleMapsKey, redactKey } = require('./placeMap');

const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const FIELD_MASK = [
  'suggestions.placePrediction.placeId',
  'suggestions.placePrediction.structuredFormat',
  'suggestions.placePrediction.text',
].join(',');
const MAX_RESULTS = 5;

function autocompleteRequest(query, key) {
  return {
    url: AUTOCOMPLETE_URL,
    body: { input: query },
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': FIELD_MASK,
    },
  };
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

function textOf(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && typeof value.text === 'string') {
    return value.text.trim();
  }
  return '';
}

function suggestionFromPrediction(prediction) {
  if (!prediction || typeof prediction !== 'object') return null;
  const placeId = String(prediction.placeId || '').trim();
  if (!placeId) return null;
  const formatting = prediction.structuredFormat || {};
  const main = textOf(formatting.mainText);
  const secondary = textOf(formatting.secondaryText);
  const description = textOf(prediction.text);
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
  if (data.error) {
    return { error: googleMessage(data) || 'Could not search places' };
  }
  const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
  const places = [];
  for (const suggestion of suggestions) {
    const prediction = suggestion && suggestion.placePrediction;
    const row = suggestionFromPrediction(prediction);
    if (!row) continue;
    places.push(row);
    if (places.length >= MAX_RESULTS) break;
  }
  return { places };
}

async function defaultPost(url, body, headers) {
  const res = await axios.post(url, body, {
    timeout: 15000,
    headers,
    validateStatus: () => true,
  });
  return {
    status: res.status,
    body: res.data,
  };
}

// Places API (New) Autocomplete. Returns a short list of placeId, name, and address.
async function searchPlaces(query, { post } = {}) {
  const key = googleMapsKey();
  if (!key) {
    return { status: 503, msg: 'Google Maps is not configured' };
  }
  const q = String(query || '').trim();
  if (!q) {
    return { status: 400, msg: 'Query is required' };
  }

  const request = autocompleteRequest(q, key);
  const fetchPlaces = post || defaultPost;
  let res;
  try {
    res = await fetchPlaces(request.url, request.body, request.headers);
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
  autocompleteRequest,
  placesFromPayload,
  AUTOCOMPLETE_URL,
  FIELD_MASK,
  MAX_RESULTS,
};
