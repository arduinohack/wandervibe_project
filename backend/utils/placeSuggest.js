const axios = require('axios');
const { googleMapsKey, redactKey } = require('./placeMap');
const { xaiApiKey } = require('./xaiConfirmation');

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.types',
].join(',');
const MAX_RESULTS = 8;
const BIAS_RADIUS_METERS = 20000;
const XAI_ENDPOINT = 'https://api.x.ai/v1/responses';
const XAI_MODEL = 'grok-4.7';

const INCLUDED_TYPES = {
  dining: 'restaurant',
  meal: 'restaurant',
  hotel: 'lodging',
  attraction: 'tourist_attraction',
  tour: 'tourist_attraction',
};

const QUERY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['textQuery'],
  properties: {
    textQuery: { type: 'string' },
  },
};

const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summaries'],
  properties: {
    summaries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['placeId', 'summary'],
        properties: {
          placeId: { type: 'string' },
          summary: { type: 'string' },
        },
      },
    },
  },
};

function includedPlaceType(activityType) {
  const key = String(activityType || '').trim().toLowerCase();
  return INCLUDED_TYPES[key] || '';
}

function localTextQuery(query, activityType, bias) {
  let text = String(query || '').replace(/\s+/g, ' ').trim();
  const typeWord = String(activityType || '').trim();
  if (
    typeWord
    && !includedPlaceType(typeWord)
    && !text.toLowerCase().includes(typeWord.toLowerCase())
  ) {
    text = `${typeWord} ${text}`;
  }
  const place = String(bias || '').trim();
  if (place && !text.toLowerCase().includes(place.toLowerCase())) {
    text = `${text} in ${place}`;
  }
  return text.replace(/\s+/g, ' ').trim();
}

function biasText(location, destination) {
  const supplied = String(location || '').trim();
  if (supplied) return supplied;
  return String(destination || '').trim();
}

function googleMessage(data) {
  if (!data || typeof data !== 'object') return '';
  const msg = data.error_message || data.errorMessage || data.message;
  if (typeof msg === 'string' && msg.trim()) return msg.trim();
  if (data.error && typeof data.error.message === 'string' && data.error.message.trim()) {
    return data.error.message.trim();
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

function placeIdOf(place) {
  const id = String(place && place.id || '').trim();
  if (id.startsWith('places/')) return id.slice('places/'.length);
  if (id) return id;
  const name = String(place && place.name || '').trim();
  if (name.startsWith('places/')) return name.slice('places/'.length);
  return '';
}

function priceLevelOf(value) {
  const text = String(value || '').trim();
  if (!text || text === 'PRICE_LEVEL_UNSPECIFIED') return null;
  return text;
}

function reviewCountOf(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

function typesOf(value) {
  if (!Array.isArray(value)) return [];
  const types = [];
  for (const item of value) {
    const text = String(item || '').trim();
    if (!text || types.includes(text)) continue;
    types.push(text);
    if (types.length >= 12) break;
  }
  return types;
}

function rowFromPlace(place) {
  if (!place || typeof place !== 'object') return null;
  const placeId = placeIdOf(place);
  const name = textOf(place.displayName);
  if (!placeId || !name) return null;
  const rating = typeof place.rating === 'number' && Number.isFinite(place.rating)
    ? place.rating
    : null;
  return {
    placeId,
    name,
    address: String(place.formattedAddress || '').trim(),
    rating,
    reviewCount: reviewCountOf(place.userRatingCount),
    priceLevel: priceLevelOf(place.priceLevel),
    types: typesOf(place.types),
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
  const list = Array.isArray(data.places) ? data.places : [];
  const places = [];
  for (const place of list) {
    const row = rowFromPlace(place);
    if (!row) continue;
    places.push(row);
    if (places.length >= MAX_RESULTS) break;
  }
  return { places };
}

function modelOutputText(data) {
  if (!data || typeof data !== 'object') return '';
  if (typeof data.output_text === 'string') return data.output_text;
  const output = Array.isArray(data.output) ? data.output : [];
  const chunks = [];
  for (const item of output) {
    const content = Array.isArray(item && item.content) ? item.content : [];
    for (const part of content) {
      if (part && typeof part.text === 'string') chunks.push(part.text);
    }
  }
  return chunks.join('');
}

function parseModelObject(raw) {
  const text = String(raw || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  if (!text) return null;
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function cleanTextQuery(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 300) return '';
  return text;
}

function cleanSummary(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > 240 ? text.slice(0, 240).trim() : text;
}

async function defaultPost(url, body, headers) {
  const res = await axios.post(url, body, {
    timeout: 15000,
    headers,
    validateStatus: () => true,
  });
  return { status: res.status, body: res.data };
}

async function askModel(prompt, schemaName, schema) {
  const key = xaiApiKey();
  if (!key) return null;
  try {
    const response = await axios.post(
      XAI_ENDPOINT,
      {
        model: XAI_MODEL,
        input: prompt,
        text: {
          format: {
            type: 'json_schema',
            name: schemaName,
            strict: true,
            schema,
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
        validateStatus: () => true,
      },
    );
    if (!response || response.status < 200 || response.status >= 300) return null;
    return parseModelObject(modelOutputText(response.data));
  } catch (error) {
    const message = error && error.message ? error.message : 'request failed';
    console.error('Place suggest model failed:', message);
    return null;
  }
}

async function geocodeBias(address, key) {
  const query = String(address || '').trim();
  if (!query || !key) return null;
  try {
    const params = new URLSearchParams({ address: query, key });
    const res = await axios.get(`${GEOCODE_URL}?${params.toString()}`, {
      timeout: 10000,
      validateStatus: () => true,
    });
    if (!res || res.status < 200 || res.status >= 300) return null;
    const loc = res.data
      && res.data.results
      && res.data.results[0]
      && res.data.results[0].geometry
      && res.data.results[0].geometry.location;
    if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return null;
    if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return null;
    return { lat: loc.lat, lng: loc.lng };
  } catch (_) {
    return null;
  }
}

function attachSummaries(places, model) {
  const rows = model && Array.isArray(model.summaries) ? model.summaries : [];
  const byId = new Map();
  for (const row of rows) {
    const placeId = String(row && row.placeId || '').trim();
    const summary = cleanSummary(row && row.summary);
    if (placeId && summary) byId.set(placeId, summary);
  }
  return places.map((place) => {
    const summary = byId.get(place.placeId);
    if (!summary) return place;
    return { ...place, summary };
  });
}

async function suggestPlaces({
  query,
  activityType,
  location,
  destination,
} = {}) {
  const key = googleMapsKey();
  if (!key) {
    return { status: 503, msg: 'Google Maps is not configured' };
  }
  if (typeof query !== 'string' || !query.trim()) {
    return { status: 400, msg: 'Query is required' };
  }

  const typeText = typeof activityType === 'string' ? activityType : '';
  const bias = biasText(
    typeof location === 'string' ? location : '',
    destination,
  );
  let textQuery = localTextQuery(query, typeText, bias);
  if (xaiApiKey()) {
    const cleaned = await askModel(
      [
        'Turn this activity search into one Google Places text search.',
        'Keep the user intent.',
        'Include the place when one is given.',
        'Do not invent a different city.',
        `Search: ${query.trim()}`,
        typeText.trim() ? `Activity type: ${typeText.trim()}` : '',
        bias ? `Place: ${bias}` : '',
      ].filter(Boolean).join('\n'),
      'place_text_query',
      QUERY_SCHEMA,
    );
    const next = cleanTextQuery(cleaned && cleaned.textQuery);
    if (next) textQuery = next;
  }

  const body = {
    textQuery,
    pageSize: MAX_RESULTS,
  };
  const included = includedPlaceType(typeText);
  if (included) body.includedType = included;
  const point = await geocodeBias(bias, key);
  if (point) {
    body.locationBias = {
      circle: {
        center: { latitude: point.lat, longitude: point.lng },
        radius: BIAS_RADIUS_METERS,
      },
    };
  }

  let res;
  try {
    res = await defaultPost(SEARCH_URL, body, {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': FIELD_MASK,
    });
  } catch (_) {
    return { status: 502, msg: 'Could not search places' };
  }

  const parsed = placesFromPayload(res && res.body);
  if (parsed.error || !res || res.status < 200 || res.status >= 300) {
    const msg = redactKey(parsed.error || 'Could not search places', key);
    return { status: 502, msg };
  }

  let places = parsed.places;
  if (xaiApiKey() && places.length) {
    const lines = places.map((place) => (
      `${place.placeId} | ${place.name} | ${place.address}`
    ));
    const model = await askModel(
      [
        'Write one short sentence for each place.',
        'Use only the place id, name, and address given here.',
        'Do not invent prices, hours, or awards.',
        '',
        ...lines,
      ].join('\n'),
      'place_summaries',
      SUMMARY_SCHEMA,
    );
    if (model) places = attachSummaries(places, model);
  }

  return { status: 200, places };
}

module.exports = {
  suggestPlaces,
  localTextQuery,
  includedPlaceType,
  placesFromPayload,
  SEARCH_URL,
  FIELD_MASK,
  MAX_RESULTS,
  XAI_ENDPOINT,
};
