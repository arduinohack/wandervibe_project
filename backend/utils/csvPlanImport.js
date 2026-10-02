const { DateTime } = require('luxon');

function parseCsv(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    if (ch === '\r') continue;
    field += ch;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function readColumnMap(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
  if (!name) return null;
  const text = (key) => (typeof parsed[key] === 'string' ? parsed[key].trim() : '');
  return {
    name,
    type: text('type'),
    startTime: text('startTime'),
    endTime: text('endTime'),
    location: text('location'),
  };
}

function headerIndex(headers, wanted) {
  const target = String(wanted || '').trim();
  if (!target) return -1;
  const exact = headers.findIndex((header) => String(header).trim() === target);
  if (exact >= 0) return exact;
  const lower = target.toLowerCase();
  return headers.findIndex((header) => String(header).trim().toLowerCase() === lower);
}

function cell(row, index) {
  if (!row || index < 0 || index >= row.length) return '';
  return String(row[index] ?? '').trim();
}

function planZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return 'UTC';
  const zone = timeZone.trim();
  return DateTime.now().setZone(zone).isValid ? zone : 'UTC';
}

function hasExplicitZone(text) {
  return /(?:z|[+-]\d{2}:?\d{2})$/i.test(text);
}

function parseActivityTime(value, zone) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (hasExplicitZone(text)) {
    const parsed = DateTime.fromISO(text, { setZone: true });
    return parsed.isValid ? parsed.toJSDate() : null;
  }
  const iso = text.includes('T') ? text : text.replace(' ', 'T');
  const parsed = DateTime.fromISO(iso, { zone: zone || 'UTC' });
  return parsed.isValid ? parsed.toJSDate() : null;
}

function importDateStamp(timeZone) {
  return DateTime.now().setZone(planZone(timeZone)).toFormat('yyyy-MM-dd');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uploadKind(file) {
  if (!file || !file.buffer) return 'missing';
  const name = String(file.originalname || '').trim().toLowerCase();
  const type = String(file.mimetype || '').toLowerCase();
  const spreadsheet = name.endsWith('.xlsx')
    || name.endsWith('.xls')
    || type.includes('spreadsheet')
    || type === 'application/vnd.ms-excel';
  if (spreadsheet) return 'spreadsheet';
  if (!name.endsWith('.csv')) return 'notcsv';
  return 'csv';
}

module.exports = {
  parseCsv,
  readColumnMap,
  headerIndex,
  cell,
  planZone,
  parseActivityTime,
  importDateStamp,
  escapeRegExp,
  uploadKind,
};
