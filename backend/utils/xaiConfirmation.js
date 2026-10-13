const axios = require('axios');

const MODEL = 'grok-4.7';
const ENDPOINT = 'https://api.x.ai/v1/responses';

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const MONTH_SHORT = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'bookingReference',
    'confirmation',
    'origin',
    'destination',
    'start',
    'end',
  ],
  properties: {
    bookingReference: { type: ['string', 'null'] },
    confirmation: { type: ['string', 'null'] },
    origin: { type: ['string', 'null'] },
    destination: { type: ['string', 'null'] },
    start: { type: ['string', 'null'] },
    end: { type: ['string', 'null'] },
  },
};

function xaiApiKey() {
  const key = process.env.XAI_API_KEY;
  return typeof key === 'string' ? key.trim() : '';
}

function hasTokenNumber(source, value) {
  const raw = String(value);
  const padded = raw.padStart(2, '0');
  const body = padded === raw ? raw : `(?:${raw}|${padded})`;
  return new RegExp(`(^|\\D)${body}(\\D|$)`).test(source);
}

function monthInText(source, month) {
  const lower = source.toLowerCase();
  if (lower.includes(MONTH_NAMES[month - 1])) return true;
  if (MONTH_SHORT[month - 1] !== MONTH_NAMES[month - 1]
    && lower.includes(MONTH_SHORT[month - 1])) {
    return true;
  }
  return hasTokenNumber(source, month);
}

function textValue(value, source) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (!source.toLowerCase().includes(text.toLowerCase())) return '';
  return text;
}

function dateValue(value, source) {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
  if (!match) return '';
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] == null ? null : Number(match[4]);
  const minute = match[5] == null ? null : Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  if (hour != null && (hour > 23 || minute > 59)) return '';
  if (!hasTokenNumber(source, Number(match[1]))) return '';
  if (!monthInText(source, month)) return '';
  if (!hasTokenNumber(source, day)) return '';
  if (hour != null) {
    const hh = String(hour).padStart(2, '0');
    const mm = String(minute).padStart(2, '0');
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    const forms = [`${hh}:${mm}`, `${hour}:${mm}`, `${hour12}:${mm}`];
    if (!forms.some((form) => source.includes(form))) return '';
  }
  return hour == null
    ? `${match[1]}-${match[2]}-${match[3]}`
    : `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`;
}

function onlyFound(model, source) {
  const found = {};
  const bookingReference = textValue(model.bookingReference, source);
  const confirmation = textValue(model.confirmation, source);
  const origin = textValue(model.origin, source);
  const destination = textValue(model.destination, source);
  const start = dateValue(model.start, source);
  const end = dateValue(model.end, source);
  if (bookingReference) found.bookingReference = bookingReference;
  if (confirmation) found.confirmation = confirmation;
  if (origin) found.origin = origin;
  if (destination) found.destination = destination;
  if (start) found.start = start;
  if (end) found.end = end;
  return found;
}

function outputText(data) {
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

function parseModelJson(raw) {
  const text = String(raw || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  if (!text) return null;
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return data;
}

function promptFor(text) {
  return [
    'Read this flight confirmation.',
    'Return only booking reference, confirmation, origin, destination, start, and end when that value is written in the text.',
    'Booking reference and confirmation are different fields.',
    'Copy codes and place names as written.',
    'For start and end, use YYYY-MM-DDTHH:mm when a time is written, and YYYY-MM-DD when only a date is written.',
    'Use null when a value is not written. Do not guess.',
    '',
    text,
  ].join('\n');
}

// Null means the model call failed. An object, including {}, means it succeeded.
async function flightFieldsFromModel(text) {
  const key = xaiApiKey();
  if (!key) return null;
  try {
    const response = await axios.post(
      ENDPOINT,
      {
        model: MODEL,
        input: promptFor(text),
        text: {
          format: {
            type: 'json_schema',
            name: 'flight_confirmation',
            strict: true,
            schema: SCHEMA,
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      },
    );
    const model = parseModelJson(outputText(response && response.data));
    if (!model) return null;
    return onlyFound(model, String(text || ''));
  } catch (error) {
    const message = error && error.message ? error.message : 'request failed';
    console.error('Confirmation model failed:', message);
    return null;
  }
}

module.exports = { xaiApiKey, flightFieldsFromModel };
