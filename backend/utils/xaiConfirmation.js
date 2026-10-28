const axios = require('axios');
const { logModelAttempt, recordAiUsage } = require('./aiUsage');
const {
  INSUFFICIENT_MESSAGE,
  PASTE_CREDIT_COST,
  usesServerKey,
  getBalance,
  deduct,
} = require('./aiCredits');

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

const TRAVEL_SCHEMA = {
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

const HOTEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['bookingReference', 'confirmation', 'name', 'start', 'end'],
  properties: {
    bookingReference: { type: ['string', 'null'] },
    confirmation: { type: ['string', 'null'] },
    name: { type: ['string', 'null'] },
    start: { type: ['string', 'null'] },
    end: { type: ['string', 'null'] },
  },
};

function xaiApiKey() {
  const key = process.env.XAI_API_KEY;
  return typeof key === 'string' ? key.trim() : '';
}

// Undefined keeps the server key for direct calls. Null or an unsupported client skips AI.
function apiKeyFromClient(aiClient) {
  if (aiClient === undefined) return xaiApiKey();
  if (!aiClient || aiClient.supported === false) return '';
  const key = aiClient.apiKey;
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

function onlyFound(model, source, type) {
  const found = {};
  const bookingReference = textValue(model.bookingReference, source);
  const confirmation = textValue(model.confirmation, source);
  const start = dateValue(model.start, source);
  const end = dateValue(model.end, source);
  if (bookingReference) found.bookingReference = bookingReference;
  if (confirmation) found.confirmation = confirmation;
  if (start) found.start = start;
  if (end) found.end = end;
  if (type === 'hotel') {
    const name = textValue(model.name, source);
    if (name) found.name = name;
    return found;
  }
  const origin = textValue(model.origin, source);
  const destination = textValue(model.destination, source);
  if (origin) found.origin = origin;
  if (destination) found.destination = destination;
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

function promptFor(text, type) {
  const kind = type === 'hotel' ? 'hotel' : type;
  const fields = type === 'hotel'
    ? 'booking reference, confirmation, name, start, and end'
    : 'booking reference, confirmation, origin, destination, start, and end';
  const placeRule = type === 'hotel'
    ? 'Do not return an origin or a destination.'
    : 'Copy origin and destination as written.';
  return [
    `Read this ${kind} confirmation.`,
    `Return only ${fields} when that value is written in the text.`,
    'Booking reference and confirmation are different fields.',
    placeRule,
    'Copy codes and place names as written.',
    'For start and end, use YYYY-MM-DDTHH:mm when a time is written, and YYYY-MM-DD when only a date is written.',
    'Use null when a value is not written. Do not guess.',
    '',
    text,
  ].join('\n');
}

function insufficientPaste() {
  return { insufficientCredits: true };
}

async function noteInsufficientCredits(usage) {
  await recordAiUsage({
    userId: usage && usage.userId,
    planId: usage && usage.planId,
    feature: (usage && usage.feature) || 'paste',
    provider: 'server',
    usedUserKey: false,
    success: false,
    error: INSUFFICIENT_MESSAGE,
  });
}

// Null means the model call failed. An object, including {}, means it succeeded.
// { insufficientCredits: true } means the server key was not called.
async function confirmationFieldsFromModel(text, type, aiClient, usage) {
  const key = apiKeyFromClient(aiClient);
  if (!key) return null;
  const charge = usesServerKey(aiClient);
  if (charge) {
    const balance = await getBalance(usage && usage.userId);
    if (balance < PASTE_CREDIT_COST) {
      await noteInsufficientCredits(usage);
      return insufficientPaste();
    }
  }
  const hotel = type === 'hotel';
  try {
    const response = await axios.post(
      ENDPOINT,
      {
        model: MODEL,
        input: promptFor(text, type),
        text: {
          format: {
            type: 'json_schema',
            name: hotel ? 'hotel_confirmation' : 'trip_confirmation',
            strict: true,
            schema: hotel ? HOTEL_SCHEMA : TRAVEL_SCHEMA,
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
    if (!model) {
      await logModelAttempt(usage, {
        aiClient,
        data: response && response.data,
        fallbackModel: MODEL,
        success: false,
        error: 'invalid model response',
        secret: key,
      });
      return null;
    }
    if (charge) {
      const paid = await deduct(usage && usage.userId, PASTE_CREDIT_COST);
      if (!paid.ok) {
        await noteInsufficientCredits(usage);
        return insufficientPaste();
      }
    }
    await logModelAttempt(usage, {
      aiClient,
      data: response && response.data,
      fallbackModel: MODEL,
      success: true,
      secret: key,
    });
    return onlyFound(model, String(text || ''), type);
  } catch (error) {
    const message = error && error.message ? error.message : 'request failed';
    console.error('Confirmation model failed:', message);
    await logModelAttempt(usage, {
      aiClient,
      data: error && error.response && error.response.data,
      fallbackModel: MODEL,
      success: false,
      error: message,
      secret: key,
    });
    return null;
  }
}

module.exports = { xaiApiKey, apiKeyFromClient, confirmationFieldsFromModel };
