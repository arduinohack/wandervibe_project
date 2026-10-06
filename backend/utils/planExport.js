const { DateTime } = require('luxon');

const EXPORT_FIELDS = [
  'name',
  'type',
  'start',
  'end',
  'duration',
  'location',
  'details',
  'googlePlaceId',
  'bookingReference',
  'cost',
  'costType',
  'gate',
  'baggageClaim',
  'roomNumber',
  'serviceProvider',
  'status',
  'customType',
  'urlLinks',
];

const FIELD_SET = new Set(EXPORT_FIELDS);

function validZone(value) {
  if (typeof value !== 'string') return '';
  const zone = value.trim();
  if (!zone) return '';
  return DateTime.now().setZone(zone).isValid ? zone : '';
}

function startZone(activity, planTimeZone) {
  return validZone(activity.startTimeZone)
    || validZone(activity.originTimeZone)
    || validZone(activity.timeZone)
    || validZone(planTimeZone)
    || 'UTC';
}

function endZone(activity, planTimeZone) {
  return validZone(activity.endTimeZone)
    || validZone(activity.destinationTimeZone)
    || startZone(activity, planTimeZone);
}

function zoneAbbreviation(date, zone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'short',
    }).formatToParts(date);
    const name = parts.find((part) => part.type === 'timeZoneName');
    return name && name.value ? name.value : '';
  } catch (err) {
    return '';
  }
}

function wallClock(value, zone) {
  if (value == null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const dt = DateTime.fromJSDate(date, { zone: zone || 'UTC' });
  if (!dt.isValid) return '';
  const clock = dt.toFormat('MM/dd/yy HH:mm');
  const abbr = zoneAbbreviation(date, zone || 'UTC');
  return abbr ? `${clock} ${abbr}` : clock;
}

function textCell(value) {
  if (value == null) return '';
  return String(value).trim();
}

function numberCell(value) {
  if (value == null || value === '') return '';
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(number) ? number : '';
}

function urlLinksCell(links) {
  if (!Array.isArray(links) || !links.length) return '';
  const stored = [];
  for (const link of links) {
    if (!link || typeof link !== 'object') continue;
    const linkName = textCell(link.linkName);
    const linkUrl = textCell(link.linkUrl);
    if (!linkName && !linkUrl) continue;
    stored.push({ linkName, linkUrl });
  }
  return stored.length ? JSON.stringify(stored) : '';
}

function cellValue(activity, field, planTimeZone) {
  switch (field) {
    case 'name':
      return textCell(activity.name);
    case 'type':
      return textCell(activity.type);
    case 'start':
      return wallClock(activity.startTime, startZone(activity, planTimeZone));
    case 'end':
      return wallClock(activity.endTime, endZone(activity, planTimeZone));
    case 'duration':
      return numberCell(activity.durationMinutes);
    case 'location':
      return textCell(activity.location);
    case 'details':
      return textCell(activity.details);
    case 'googlePlaceId':
      return textCell(activity.googlePlaceId);
    case 'bookingReference':
      return textCell(activity.bookingReference);
    case 'cost':
      return numberCell(activity.cost);
    case 'costType':
      return textCell(activity.costType);
    case 'gate':
      return textCell(activity.gate);
    case 'baggageClaim':
      return textCell(activity.baggageClaim);
    case 'roomNumber':
      return textCell(activity.roomNumber);
    case 'serviceProvider':
      return textCell(activity.serviceProvider);
    case 'status':
      return textCell(activity.status);
    case 'customType':
      return textCell(activity.customType);
    case 'urlLinks':
      return urlLinksCell(activity.urlLinks);
    default:
      return '';
  }
}

function fieldList(value) {
  if (Array.isArray(value)) return value.flatMap((item) => fieldList(item));
  if (typeof value !== 'string') return [];
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

function readExportQuery(query) {
  const source = query && typeof query === 'object' ? query : {};
  const format = typeof source.format === 'string' ? source.format.trim().toLowerCase() : '';
  if (format !== 'csv' && format !== 'xlsx') {
    return { error: 'Query format must be csv or xlsx' };
  }
  const requested = fieldList(source.fields);
  if (!requested.length) return { error: 'At least one field is required' };
  // The query order is the column order.
  const fields = [];
  const seen = new Set();
  for (const field of requested) {
    if (!FIELD_SET.has(field)) return { error: 'Unknown export field' };
    if (seen.has(field)) continue;
    seen.add(field);
    fields.push(field);
  }
  return { format, fields };
}

function exportRows(activities, fields, planTimeZone) {
  return activities.map((activity) => (
    fields.map((field) => cellValue(activity, field, planTimeZone))
  ));
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function buildCsv(fields, rows) {
  const lines = [fields.map(csvEscape).join(',')];
  for (const row of rows) lines.push(row.map(csvEscape).join(','));
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
}

function columnName(index) {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function xmlText(value) {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sheetXml(fields, rows) {
  const all = [fields, ...rows];
  const body = all.map((row, rowIndex) => {
    const cells = [];
    row.forEach((value, columnIndex) => {
      if (value == null || value === '') return;
      const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
      if (typeof value === 'number') {
        cells.push(`<c r="${ref}"><v>${value}</v></c>`);
        return;
      }
      cells.push(`<c r="${ref}" t="inlineStr"><is><t>${xmlText(value)}</t></is></c>`);
    });
    return `<row r="${rowIndex + 1}">${cells.join('')}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${body}</sheetData></worksheet>`;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(Buffer.concat([local, name, data]));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    offset += 30 + name.length + data.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, eocd]);
}

function buildXlsx(fields, rows) {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="Activities" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `</Relationships>`;
  return zipStore([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml(fields, rows) },
  ]);
}

function exportFilename(planName, format) {
  const cleaned = String(planName || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const base = cleaned || 'plan';
  return `${base}.${format === 'xlsx' ? 'xlsx' : 'csv'}`;
}

function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, ' ').replace(/["\\]/g, ' ');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function buildPlanExport({ planName, planTimeZone, activities, fields, format }) {
  const rows = exportRows(activities, fields, planTimeZone);
  const filename = exportFilename(planName, format);
  if (format === 'xlsx') {
    return {
      body: buildXlsx(fields, rows),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: contentDisposition(filename),
    };
  }
  return {
    body: buildCsv(fields, rows),
    contentType: 'text/csv; charset=utf-8',
    disposition: contentDisposition(filename),
  };
}

module.exports = {
  EXPORT_FIELDS,
  readExportQuery,
  buildPlanExport,
};
