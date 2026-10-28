const axios = require('axios');
const { DateTime } = require('luxon');
const { Event } = require('../models/Event');
const { suggestPlaces } = require('./placeSuggest');
const { apiKeyFromClient } = require('./xaiConfirmation');
const { logModelAttempt, recordAiUsage } = require('./aiUsage');
const {
  INSUFFICIENT_MESSAGE,
  COMMAND_CREDIT_COST,
  usesServerKey,
  getBalance,
  deduct,
} = require('./aiCredits');
const {
  createActivity,
  updateActivity,
  deleteActivity,
} = require('../routes/events');

const XAI_ENDPOINT = 'https://api.x.ai/v1/responses';
const XAI_MODEL = 'grok-4.7';
const UNREADABLE = 'Could not read the AI edit';
const NOT_CONFIGURED = 'AI is not configured';
const INVALID_PROPOSAL = 'Invalid proposal';
const EVENT_MISSING = 'Event not found';

// Propose does not write activities. The balance is checked before a server-key
// model call, and 1 credit is deducted after a usable proposal. A user key
// costs nothing. Place search runs only for an add, without a second model
// call or a second credit charge. Apply writes through activity create, update,
// and delete.

const TYPE_ALIASES = {
  dinner: 'dining',
  lunch: 'dining',
  breakfast: 'dining',
  brunch: 'dining',
  restaurant: 'dining',
  meal: 'dining',
  museum: 'attraction',
  sightseeing: 'attraction',
};

const ACTIVITY_TYPES = [
  'flight',
  'train',
  'car',
  'car_service',
  'dining',
  'hotel',
  'tour',
  'attraction',
  'cruise',
  'ceremony',
  'reception',
  'shuttle',
  'custom',
];

const COMMAND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'message', 'activityId', 'activity', 'changes'],
  properties: {
    action: { type: 'string', enum: ['add', 'update', 'delete', 'none'] },
    message: { type: 'string' },
    activityId: { type: 'string' },
    activity: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'type', 'location', 'startTime', 'endTime', 'details', 'googlePlaceId'],
      properties: {
        title: { type: 'string' },
        type: { type: 'string' },
        location: { type: 'string' },
        startTime: { type: 'string' },
        endTime: { type: 'string' },
        details: { type: 'string' },
        googlePlaceId: { type: 'string' },
      },
    },
    changes: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'startTime', 'endTime', 'location', 'details'],
      properties: {
        title: { type: 'string' },
        startTime: { type: 'string' },
        endTime: { type: 'string' },
        location: { type: 'string' },
        details: { type: 'string' },
      },
    },
  },
};

function clip(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max).trim();
}

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function activityTypeName(value) {
  const text = clip(value, 40).toLowerCase();
  if (!text) return '';
  return TYPE_ALIASES[text] || text;
}

function isoOrBlank(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function clockLabel(iso, zone) {
  const parsed = DateTime.fromISO(iso, { setZone: true });
  if (!parsed.isValid) return iso;
  const zoneName = typeof zone === 'string' && DateTime.now().setZone(zone).isValid
    ? zone
    : 'UTC';
  return parsed.setZone(zoneName).toFormat('ccc LLL d, h:mm a');
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

function activityLine(activity) {
  const start = activity.startTime ? new Date(activity.startTime).toISOString() : '';
  const end = activity.endTime ? new Date(activity.endTime).toISOString() : '';
  return [
    String(activity._id),
    clip(activity.name, 80),
    clip(activity.type, 40),
    start,
    end,
    clip(activity.location, 80),
  ].join(' | ');
}

function planContext(plan, activities) {
  const lines = [
    `Name: ${clip(plan.name, 120)}`,
    `Destination: ${clip(plan.destination, 120)}`,
    `Time zone: ${clip(plan.timeZone, 80)}`,
    `Start: ${plan.startDate ? new Date(plan.startDate).toISOString() : ''}`,
    `End: ${plan.endDate ? new Date(plan.endDate).toISOString() : ''}`,
    'Day 1 is the plan start date when that date is set.',
    'Activities (id | name | type | start | end | location):',
  ];
  const rows = activities.slice(0, 80).map(activityLine);
  if (!rows.length) lines.push('(none)');
  else lines.push(...rows);
  return lines.join('\n');
}

function commandPrompt(plan, activities, instruction) {
  return [
    'You propose one change to a plan. Return JSON only.',
    'action is add, update, delete, or none.',
    'For add, fill activity title, type, location, startTime, and endTime.',
    `type is one of: ${ACTIVITY_TYPES.join(', ')}.`,
    'startTime and endTime are ISO-8601. Use the plan time zone when the instruction names a clock time.',
    'For update or delete, activityId must be an id from the activity list.',
    'changes on update may set title, startTime, endTime, location, and details.',
    'Leave every unused string empty.',
    'Use none with a short message when the instruction does not name one change.',
    'Leave googlePlaceId empty.',
    '',
    planContext(plan, activities),
    '',
    `Instruction: ${instruction}`,
  ].join('\n');
}

function findListed(activities, activityId) {
  return activities.find((row) => String(row._id) === String(activityId)) || null;
}

function proposalFromModel(raw, activities, zone) {
  const action = clip(raw && raw.action, 20).toLowerCase();
  if (action === 'none') {
    const message = clip(raw && raw.message, 240) || 'No change.';
    return {
      summary: message,
      proposal: { action: 'none', message },
    };
  }
  if (action === 'add') {
    const source = asObject(raw && raw.activity) || {};
    const title = clip(source.title, 200);
    const type = activityTypeName(source.type);
    if (!title || !type) return null;
    const startTime = isoOrBlank(source.startTime);
    const endTime = isoOrBlank(source.endTime);
    if (startTime == null || endTime == null) return null;
    const activity = {
      title,
      type,
      location: clip(source.location, 300),
    };
    if (startTime) activity.startTime = startTime;
    if (endTime) activity.endTime = endTime;
    const details = clip(source.details, 2000);
    if (details) activity.details = details;
    return {
      summary: addSummary(activity, '', zone),
      proposal: { action: 'add', activity },
      placeQuery: needsPlace(activity),
    };
  }
  if (action === 'update') {
    const activityId = clip(raw && raw.activityId, 80);
    const source = asObject(raw && raw.changes);
    if (!activityId || !source) return null;
    const changes = {};
    const title = clip(source.title, 200);
    if (title) changes.title = title;
    const startTime = isoOrBlank(source.startTime);
    const endTime = isoOrBlank(source.endTime);
    if (startTime == null || endTime == null) return null;
    if (startTime) changes.startTime = startTime;
    if (endTime) changes.endTime = endTime;
    const location = clip(source.location, 300);
    if (location) changes.location = location;
    const details = clip(source.details, 2000);
    if (details) changes.details = details;
    if (!Object.keys(changes).length) return null;
    const listed = findListed(activities, activityId);
    const name = listed ? clip(listed.name, 120) : 'this activity';
    let summary = `Update ${name}.`;
    if (changes.startTime && Object.keys(changes).every((key) => key === 'startTime' || key === 'endTime')) {
      summary = `Move ${name} to ${clockLabel(changes.startTime, zone)}.`;
    } else if (changes.title) {
      summary = `Rename ${name} to ${changes.title}.`;
    }
    return {
      summary: clip(summary, 240),
      proposal: { action: 'update', activityId, changes },
    };
  }
  if (action === 'delete') {
    const activityId = clip(raw && raw.activityId, 80);
    if (!activityId) return null;
    const listed = findListed(activities, activityId);
    const name = listed ? clip(listed.name, 120) : 'this activity';
    return {
      summary: clip(`Delete ${name}.`, 240),
      proposal: { action: 'delete', activityId },
    };
  }
  return null;
}

async function askCommandModel(prompt, apiKey) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key) return { ok: false, error: NOT_CONFIGURED };
  try {
    const response = await axios.post(
      XAI_ENDPOINT,
      {
        model: XAI_MODEL,
        input: prompt,
        text: {
          format: {
            type: 'json_schema',
            name: 'plan_ai_command',
            strict: true,
            schema: COMMAND_SCHEMA,
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
    const status = response && response.status;
    const ok = Boolean(response && status >= 200 && status < 300);
    const parsed = ok ? parseModelObject(modelOutputText(response && response.data)) : null;
    return {
      ok: Boolean(ok && parsed),
      parsed,
      data: response && response.data,
      error: ok ? 'invalid model response' : `status ${status || 0}`,
    };
  } catch (error) {
    const message = error && error.message ? error.message : 'request failed';
    return {
      ok: false,
      data: error && error.response && error.response.data,
      error: message,
    };
  }
}

const PLACE_TYPES = new Set(['dining', 'hotel', 'attraction', 'tour', 'meal']);

function needsPlace(activity) {
  if (!activity) return false;
  if (clip(activity.location, 300)) return true;
  return PLACE_TYPES.has(activity.type);
}

function addSummary(activity, placeName, zone) {
  const title = activity.title;
  const where = placeName || activity.location;
  const when = activity.startTime ? clockLabel(activity.startTime, zone) : '';
  if (where && when) return clip(`Add ${title} at ${where}, ${when}.`, 240);
  if (where) return clip(`Add ${title} at ${where}.`, 240);
  if (when) return clip(`Add ${title} ${when}.`, 240);
  return clip(`Add ${title}.`, 240);
}

function placeSearchQuery(activity) {
  const location = clip(activity && activity.location, 200);
  const title = clip(activity && activity.title, 120);
  if (location && title && location.toLowerCase() !== title.toLowerCase()) {
    return clip(`${title} ${location}`, 240);
  }
  return location || title;
}

async function attachPlace(activity, plan) {
  const query = placeSearchQuery(activity);
  if (!query) return { activity, placeName: '' };
  try {
    const result = await suggestPlaces({
      query,
      activityType: activity.type,
      location: activity.location || '',
      destination: plan && plan.destination ? String(plan.destination) : '',
      aiClient: null,
    });
    const places = result && result.status === 200 && Array.isArray(result.places)
      ? result.places
      : [];
    const place = places[0];
    const placeId = place ? clip(place.placeId, 200) : '';
    if (!placeId) return { activity, placeName: '' };
    const next = { ...activity, googlePlaceId: placeId };
    const address = place ? clip(place.address, 300) : '';
    if (!next.location && address) next.location = address;
    return { activity: next, placeName: place ? clip(place.name, 120) : '' };
  } catch (_) {
    return { activity, placeName: '' };
  }
}

async function noteInsufficient(userId, planId) {
  await recordAiUsage({
    userId,
    planId,
    feature: 'command',
    provider: 'server',
    usedUserKey: false,
    success: false,
    error: INSUFFICIENT_MESSAGE,
  });
}

async function noteAttempt(usage, outcome) {
  await logModelAttempt(usage, {
    aiClient: usage && usage.aiClient,
    data: outcome && outcome.data,
    fallbackModel: XAI_MODEL,
    success: Boolean(outcome && outcome.success),
    error: outcome && outcome.error,
    secret: outcome && outcome.secret,
  });
}

async function proposePlanCommand({ plan, instruction, aiClient, userId }) {
  const planId = String(plan && plan._id || '');
  const usage = {
    userId: String(userId || ''),
    planId,
    feature: 'command',
    aiClient,
  };
  const modelKey = apiKeyFromClient(aiClient);
  if (!modelKey) return { status: 503, message: NOT_CONFIGURED };

  const serverCharge = usesServerKey(aiClient);
  if (serverCharge) {
    const balance = await getBalance(userId);
    if (balance < COMMAND_CREDIT_COST) {
      await noteInsufficient(userId, planId);
      return { status: 402, message: INSUFFICIENT_MESSAGE };
    }
  }

  const activities = await Event.find({ planId })
    .select('_id name type location startTime endTime')
    .lean();
  activities.sort((left, right) => {
    const leftTime = left.startTime ? new Date(left.startTime).getTime() : 0;
    const rightTime = right.startTime ? new Date(right.startTime).getTime() : 0;
    return leftTime - rightTime;
  });

  const asked = await askCommandModel(
    commandPrompt(plan, activities, instruction),
    modelKey,
  );
  const built = asked.ok ? proposalFromModel(asked.parsed, activities, plan.timeZone) : null;
  if (!built) {
    await noteAttempt(usage, {
      data: asked.data,
      success: false,
      error: asked.error || UNREADABLE,
      secret: modelKey,
    });
    return { status: 502, message: UNREADABLE };
  }

  if (serverCharge) {
    const paid = await deduct(userId, COMMAND_CREDIT_COST);
    if (!paid.ok) {
      await noteInsufficient(userId, planId);
      return { status: 402, message: INSUFFICIENT_MESSAGE };
    }
  }

  let summary = built.summary;
  let proposal = built.proposal;
  if (built.placeQuery && proposal.activity) {
    const attached = await attachPlace(proposal.activity, plan);
    proposal = { action: 'add', activity: attached.activity };
    summary = addSummary(attached.activity, attached.placeName, plan.timeZone);
  }

  await noteAttempt(usage, {
    data: asked.data,
    success: true,
    secret: modelKey,
  });
  return { status: 200, summary, proposal };
}

function requiredText(value, max) {
  if (typeof value !== 'string') return '';
  return clip(value, max);
}

function optionalText(source, key, max) {
  if (!source || !Object.prototype.hasOwnProperty.call(source, key)) return { ok: true, present: false };
  if (typeof source[key] !== 'string') return { ok: false };
  return { ok: true, present: true, value: clip(source[key], max) };
}

function optionalTime(source, key) {
  const read = optionalText(source, key, 40);
  if (!read.ok || !read.present) return read;
  if (!read.value) return { ok: true, present: false };
  const iso = isoOrBlank(read.value);
  if (!iso) return { ok: false };
  return { ok: true, present: true, value: iso };
}

async function activityOnPlan(planId, activityId) {
  const event = await Event.findById(activityId).select('planId').lean();
  if (!event || String(event.planId) !== String(planId)) return null;
  return event;
}

async function applyPlanCommand({ planId, callerId, proposal }) {
  const body = asObject(proposal);
  const action = body ? clip(body.action, 20).toLowerCase() : '';
  if (action === 'add') {
    const activity = asObject(body.activity);
    if (!activity) return { status: 400, body: { message: INVALID_PROPOSAL } };
    const title = requiredText(activity.title, 200);
    const type = activityTypeName(activity.type);
    if (!title || !type) return { status: 400, body: { message: INVALID_PROPOSAL } };
    const location = optionalText(activity, 'location', 300);
    const details = optionalText(activity, 'details', 2000);
    const startTime = optionalTime(activity, 'startTime');
    const endTime = optionalTime(activity, 'endTime');
    const googlePlaceId = optionalText(activity, 'googlePlaceId', 200);
    if (!location.ok || !details.ok || !startTime.ok || !endTime.ok || !googlePlaceId.ok) {
      return { status: 400, body: { message: INVALID_PROPOSAL } };
    }
    const createBody = {
      planId,
      name: title,
      type,
      location: location.present ? location.value : '',
    };
    if (details.present && details.value) createBody.details = details.value;
    if (startTime.present) createBody.startTime = startTime.value;
    if (endTime.present) createBody.endTime = endTime.value;
    if (googlePlaceId.present && googlePlaceId.value) {
      createBody.googlePlaceId = googlePlaceId.value;
    }
    return createActivity(callerId, createBody);
  }

  if (action === 'update') {
    const activityId = requiredText(body.activityId, 80);
    const changes = asObject(body.changes);
    if (!activityId || !changes) return { status: 400, body: { message: INVALID_PROPOSAL } };
    const onPlan = await activityOnPlan(planId, activityId);
    if (!onPlan) return { status: 404, body: { message: EVENT_MISSING } };
    const updateBody = {};
    const title = optionalText(changes, 'title', 200);
    const location = optionalText(changes, 'location', 300);
    const details = optionalText(changes, 'details', 2000);
    const startTime = optionalTime(changes, 'startTime');
    const endTime = optionalTime(changes, 'endTime');
    if (!title.ok || !location.ok || !details.ok || !startTime.ok || !endTime.ok) {
      return { status: 400, body: { message: INVALID_PROPOSAL } };
    }
    if (title.present) {
      if (!title.value) return { status: 400, body: { message: INVALID_PROPOSAL } };
      updateBody.name = title.value;
    }
    if (location.present) updateBody.location = location.value;
    if (details.present) updateBody.details = details.value;
    if (startTime.present) updateBody.startTime = startTime.value;
    if (endTime.present) updateBody.endTime = endTime.value;
    if (!Object.keys(updateBody).length) {
      return { status: 400, body: { message: INVALID_PROPOSAL } };
    }
    return updateActivity(callerId, activityId, updateBody);
  }

  if (action === 'delete') {
    const activityId = requiredText(body.activityId, 80);
    if (!activityId) return { status: 400, body: { message: INVALID_PROPOSAL } };
    const onPlan = await activityOnPlan(planId, activityId);
    if (!onPlan) return { status: 404, body: { message: EVENT_MISSING } };
    const result = await deleteActivity(callerId, activityId);
    if (result.status !== 200) return result;
    return { status: 200, body: { deleted: true } };
  }

  return { status: 400, body: { message: INVALID_PROPOSAL } };
}

module.exports = {
  proposePlanCommand,
  applyPlanCommand,
  XAI_ENDPOINT,
  XAI_MODEL,
};
