const SHARED_FIELDS = [
  'name',
  'startTime',
  'endTime',
  'location',
  'details',
  'cost',
  'costType',
  'status',
  'serviceProvider',
  'bookingReference',
  'urlLinks',
  'planId',
  'ownerId',
  'eventNum',
  'extras',
  'timeZone',
  'startTimeZone',
  'endTimeZone',
];

// Field → activity types that keep it. Schema default is '' only for customType.
const FIELD_TYPES = {
  originTimeZone: ['flight', 'train'],
  destinationTimeZone: ['flight', 'train'],
  gate: ['flight'],
  baggageClaim: ['flight'],
  roomNumber: ['hotel', 'ceremony', 'reception'],
  customType: ['custom'],
};

const CLEARED_VALUE = {
  customType: '',
};

function normalizeType(type) {
  return typeof type === 'string' ? type.trim().toLowerCase() : '';
}

function hasOwn(source, field) {
  return !!source && Object.prototype.hasOwnProperty.call(source, field);
}

function plainActivity(activity) {
  if (activity && typeof activity.toObject === 'function') return activity.toObject();
  return activity || {};
}

function clearedValue(field) {
  return hasOwn(CLEARED_VALUE, field) ? CLEARED_VALUE[field] : undefined;
}

function specificFieldsFor(type) {
  const normalized = normalizeType(type);
  return Object.keys(FIELD_TYPES).filter((field) => FIELD_TYPES[field].includes(normalized));
}

function applyTypeChange(existingActivity, newType, body) {
  const existing = plainActivity(existingActivity);
  const incoming = body && typeof body === 'object' ? body : {};
  const nextType = newType !== undefined && newType !== null && newType !== ''
    ? newType
    : (hasOwn(incoming, 'type') ? incoming.type : existing.type);
  const typeChanged = normalizeType(nextType) !== normalizeType(existing.type);
  const owned = new Set(specificFieldsFor(nextType));
  const result = { type: nextType };

  for (const field of SHARED_FIELDS) {
    if (hasOwn(incoming, field)) {
      result[field] = incoming[field];
    } else if (hasOwn(existing, field)) {
      result[field] = existing[field];
    }
  }

  for (const field of Object.keys(FIELD_TYPES)) {
    if (!owned.has(field)) {
      if (typeChanged || hasOwn(incoming, field)) {
        result[field] = clearedValue(field);
      } else if (hasOwn(existing, field)) {
        result[field] = existing[field];
      }
      continue;
    }

    if (hasOwn(incoming, field)) {
      result[field] = incoming[field];
    } else if (hasOwn(existing, field)) {
      result[field] = existing[field];
    } else if (typeChanged) {
      result[field] = clearedValue(field);
    }
  }

  return result;
}

function zonePresent(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function assertTypeRequirements(type, fields) {
  const normalized = normalizeType(type);
  if (normalized !== 'flight' && normalized !== 'train') return null;

  const source = fields || {};
  const start = zonePresent(source.startTimeZone) || zonePresent(source.originTimeZone);
  const end = zonePresent(source.endTimeZone) || zonePresent(source.destinationTimeZone);
  if (!start || !end) {
    return new Error('startTimeZone and endTimeZone are required');
  }
  return null;
}

module.exports = {
  specificFieldsFor,
  applyTypeChange,
  assertTypeRequirements,
};
