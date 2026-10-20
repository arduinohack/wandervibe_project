const { DateTime } = require('luxon');
const { Event } = require('../models/Event');
const Plan = require('../models/Plan');
const { compareStoredOrder } = require('./activityTimes');
const { recordActivityRevision } = require('./recordActivityRevision');

function instant(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sameInstant(left, right) {
  const a = instant(left);
  const b = instant(right);
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.getTime() === b.getTime();
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function zoneName(timeZone) {
  const zone = typeof timeZone === 'string' ? timeZone.trim() : '';
  if (!zone) return 'UTC';
  const check = DateTime.now().setZone(zone);
  return check.isValid ? zone : 'UTC';
}

// 8:30 AM in the plan zone, on the earliest activity's calendar day, or today.
function defaultChainStart(existingInstants, timeZone, now = new Date()) {
  const zone = zoneName(timeZone);
  let earliest = null;
  for (const value of existingInstants || []) {
    const date = instant(value);
    if (!date) continue;
    const local = DateTime.fromJSDate(date, { zone });
    if (!local.isValid) continue;
    if (!earliest || local < earliest) earliest = local;
  }
  const day = earliest
    ? earliest.startOf('day')
    : DateTime.fromJSDate(now, { zone }).startOf('day');
  return day.set({ hour: 8, minute: 30, second: 0, millisecond: 0 }).toUTC().toJSDate();
}

function preservedMinutes(durationMinutes, start, end) {
  if (typeof durationMinutes === 'number' && Number.isInteger(durationMinutes) && durationMinutes >= 0) {
    return durationMinutes;
  }
  if (start && end) {
    const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
    if (minutes >= 0) return minutes;
  }
  return null;
}

function endFromDuration(start, minutes) {
  if (!start || minutes == null) return null;
  return addMinutes(start, minutes);
}

function shiftLegs(legs, deltaMs) {
  if (!deltaMs || !Array.isArray(legs) || !legs.length) return null;
  return legs.map((leg) => {
    const next = typeof leg.toObject === 'function' ? leg.toObject() : { ...leg };
    if (next.departure) {
      next.departure = new Date(new Date(next.departure).getTime() + deltaMs);
    }
    if (next.arrival) {
      next.arrival = new Date(new Date(next.arrival).getTime() + deltaMs);
    }
    return next;
  });
}

function sourcePlanIdOf(plan) {
  return plan && typeof plan.sourcePlanId === 'string' ? plan.sourcePlanId.trim() : '';
}

function linkedIdSet(plan) {
  const sourcePlanId = sourcePlanIdOf(plan);
  if (!sourcePlanId || !Array.isArray(plan.linkedActivityIds)) return new Set();
  return new Set(plan.linkedActivityIds.map((id) => String(id)));
}

// Same rules as PUT /api/activities/order. Null when the list is acceptable.
function activityOrderError(plan, ownRows, activityIds) {
  if (!Array.isArray(activityIds)) return 'activityIds is required';
  const sourcePlanId = sourcePlanIdOf(plan);
  const linkedIds = linkedIdSet(plan);
  const ownIds = new Set(ownRows.map((row) => String(row._id)));
  const seen = new Set();
  let ownCount = 0;
  for (const id of activityIds) {
    const key = String(id);
    if (!key || seen.has(key)) return 'activityIds must list each activity once';
    seen.add(key);
    if (ownIds.has(key)) ownCount += 1;
    else if (!(sourcePlanId && linkedIds.has(key))) {
      return 'activityIds must list each activity once';
    }
  }
  if (ownCount !== ownIds.size || (!sourcePlanId && activityIds.length !== ownRows.length)) {
    return 'activityIds must list each activity once';
  }
  return null;
}

async function linkedRows(plan) {
  const sourcePlanId = sourcePlanIdOf(plan);
  const ids = [...linkedIdSet(plan)];
  if (!sourcePlanId || !ids.length) return [];
  const docs = await Event.find({ planId: sourcePlanId, _id: { $in: ids } })
    .select('_id startTime endTime durationMinutes')
    .lean();
  return docs.map((doc) => wrapRow(doc, false));
}

function wrapRow(doc, own) {
  const start = instant(doc.startTime);
  const end = instant(doc.endTime);
  return {
    id: String(doc._id),
    own,
    doc: own ? doc : null,
    eventNum: Number(doc.eventNum) || 0,
    startTime: start,
    endTime: end,
    originalStart: start,
    originalEnd: end,
    durationMinutes: doc.durationMinutes,
    minutes: preservedMinutes(doc.durationMinutes, start, end),
  };
}

function compareVisual(a, b) {
  const aStart = a.originalStart;
  const bStart = b.originalStart;
  if (!aStart && !bStart) return String(a.id).localeCompare(String(b.id));
  if (!aStart) return 1;
  if (!bStart) return -1;
  const byStart = aStart.getTime() - bStart.getTime();
  if (byStart !== 0) return byStart;
  const byNum = (Number(a.eventNum) || 0) - (Number(b.eventNum) || 0);
  if (byNum !== 0) return byNum;
  return String(a.id).localeCompare(String(b.id));
}

// Followers whose current start equals anchorEnd move onto newPriorEnd.
// A linked row or a gap stops the walk. Duration is not rewritten.
function shiftJoined(sequence, fromIndex, anchorEnd, newPriorEnd) {
  let expected = instant(anchorEnd);
  let priorEnd = instant(newPriorEnd);
  for (let index = fromIndex; index < sequence.length; index += 1) {
    const row = sequence[index];
    if (!row.own) break;
    const start = instant(row.startTime);
    if (!expected || !start || start.getTime() !== expected.getTime()) break;
    const currentEnd = instant(row.endTime);
    if (!priorEnd) break;
    const startTime = new Date(priorEnd.getTime());
    const endTime = endFromDuration(startTime, row.minutes);
    row.startTime = startTime;
    row.endTime = endTime;
    expected = currentEnd;
    priorEnd = endTime;
    if (!currentEnd) break;
  }
}

// Activities that were joined to the removed row close up to the new predecessor.
function closeHole(sequence, movedIndex) {
  const moved = sequence[movedIndex];
  if (!moved) return;
  const anchor = moved.originalEnd;
  if (!anchor) return;
  const predecessor = movedIndex > 0 ? sequence[movedIndex - 1] : null;
  const priorEnd = predecessor
    ? (instant(predecessor.endTime) || instant(predecessor.startTime))
    : moved.originalStart;
  shiftJoined(sequence, movedIndex + 1, anchor, priorEnd);
}

function placeRow(sequence, index, timeZone) {
  const row = sequence[index];
  if (!row || !row.own) return;
  const predecessor = index > 0 ? sequence[index - 1] : null;
  let start = null;
  if (predecessor) {
    start = instant(predecessor.endTime) || instant(predecessor.startTime);
  }
  if (!start) {
    const instants = [];
    for (const item of sequence) {
      if (item.originalStart) instants.push(item.originalStart);
      else if (item.originalEnd) instants.push(item.originalEnd);
    }
    start = defaultChainStart(instants, timeZone);
  }
  row.startTime = new Date(start.getTime());
  row.endTime = endFromDuration(row.startTime, row.minutes);
}

function applyTimes(doc, row) {
  const start = instant(row.startTime);
  const end = instant(row.endTime);
  if (start) doc.startTime = start;
  else doc.set('startTime', null);
  if (end) doc.endTime = end;
  else doc.set('endTime', null);
  const delta = start && row.originalStart ? start.getTime() - row.originalStart.getTime() : 0;
  const legs = shiftLegs(doc.legs, delta);
  if (legs) {
    doc.legs = legs;
    doc.markModified('legs');
  }
}

async function saveChainRow(row, eventNum, callerId) {
  if (!row.own || !row.doc) return;
  const doc = row.doc;
  const timeChanged = !sameInstant(row.startTime, row.originalStart)
    || !sameInstant(row.endTime, row.originalEnd);
  const numChanged = eventNum != null && Number(doc.eventNum) !== eventNum;
  if (!timeChanged && !numChanged) return;
  if (timeChanged) applyTimes(doc, row);
  if (numChanged) doc.eventNum = eventNum;
  await doc.save();
  if (timeChanged) await recordActivityRevision(doc, 'update', callerId);
}

// The row just before a new activity in stored order. Its end, or its start.
// With no timed predecessor, 8:30 AM on the earliest day in the plan zone.
async function placementStart(planId, { insertAfterId, insertBeforeId } = {}) {
  const rows = await Event.find({ planId }).select('_id eventNum startTime endTime').lean();
  rows.sort(compareStoredOrder);
  let predecessor = null;
  if (insertAfterId) {
    predecessor = rows.find((row) => String(row._id) === String(insertAfterId)) || null;
  } else if (insertBeforeId) {
    const index = rows.findIndex((row) => String(row._id) === String(insertBeforeId));
    if (index > 0) predecessor = rows[index - 1];
  } else if (rows.length) {
    predecessor = rows[rows.length - 1];
  }
  if (predecessor) {
    const end = instant(predecessor.endTime);
    const start = instant(predecessor.startTime);
    if (end || start) return end || start;
  }
  const plan = await Plan.findById(planId).select('timeZone').lean();
  const instants = [];
  for (const row of rows) {
    const start = instant(row.startTime);
    const end = instant(row.endTime);
    if (start) instants.push(start);
    else if (end) instants.push(end);
  }
  return defaultChainStart(instants, plan && plan.timeZone);
}

// Walk own activities after activityId. Joined means the current start equals
// anchorEnd (the previous end, or the new activity's start when it was inserted).
async function cascadeStored(planId, activityId, { anchorEnd, newEnd }, callerId) {
  const docs = await Event.find({ planId });
  docs.sort(compareStoredOrder);
  const rows = docs.map((doc) => wrapRow(doc, true));
  const index = rows.findIndex((row) => row.id === String(activityId));
  if (index < 0) return;
  shiftJoined(rows, index + 1, anchorEnd, newEnd);
  for (const row of rows) {
    await saveChainRow(row, null, callerId);
  }
}

async function applyActivityMove({ planId, movedId, activityIds, callerId }) {
  const plan = await Plan.findById(planId)
    .select('timeZone sourcePlanId linkedActivityIds')
    .lean();
  const ownDocs = await Event.find({ planId });
  const orderError = activityOrderError(plan, ownDocs, activityIds);
  if (orderError) return { error: orderError, status: 400 };
  const own = ownDocs.map((doc) => wrapRow(doc, true));
  const linked = await linkedRows(plan);
  const byId = new Map();
  for (const row of [...own, ...linked]) byId.set(row.id, row);
  if (!byId.has(String(movedId)) || !byId.get(String(movedId)).own) {
    return { error: 'Event not found', status: 404 };
  }
  const oldVisual = [...byId.values()].sort(compareVisual);
  const newVisual = [];
  for (const id of activityIds) {
    const row = byId.get(String(id));
    if (!row) return { error: 'activityIds must list each activity once', status: 400 };
    newVisual.push(row);
  }
  const oldIndex = oldVisual.findIndex((row) => row.id === String(movedId));
  const newIndex = newVisual.findIndex((row) => row.id === String(movedId));
  closeHole(oldVisual, oldIndex);
  placeRow(newVisual, newIndex, plan && plan.timeZone);
  const placed = newVisual[newIndex];
  shiftJoined(newVisual, newIndex + 1, placed.startTime, placed.endTime);
  for (let index = 0; index < newVisual.length; index += 1) {
    await saveChainRow(newVisual[index], index, callerId);
  }
  return { activityIds };
}

module.exports = {
  activityOrderError,
  placementStart,
  cascadeStored,
  applyActivityMove,
  defaultChainStart,
  sameInstant,
};
