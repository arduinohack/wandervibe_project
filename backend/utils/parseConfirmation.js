const MONTHS = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const PLACE_STOP = new Set([
  'a',
  'an',
  'attached',
  'be',
  'confirm',
  'confirmed',
  'see',
  'tba',
  'tbd',
  'the',
  'your',
]);

function pad(value) {
  return String(value).padStart(2, '0');
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function hour24(hour, ampm) {
  if (!ampm) return hour;
  const mark = ampm.toLowerCase();
  if (mark === 'am') return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
}

function formatWhen(year, month, day, time) {
  const date = `${year}-${pad(month)}-${pad(day)}`;
  if (!time) return date;
  return `${date}T${pad(time.hour)}:${pad(time.minute)}`;
}

function validDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

function timeFrom(hourText, minuteText, ampm) {
  if (hourText == null || minuteText == null) return null;
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (minute < 0 || minute > 59) return null;
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
  } else if (hour < 0 || hour > 23) {
    return null;
  }
  return { hour: hour24(hour, ampm), minute };
}

function parseWhen(raw) {
  const text = String(raw || '').trim();
  const patterns = [
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?)?\b/,
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?)?\b/,
    /^(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(\d{1,2}),?\s+(\d{4})(?:[ T](\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?)?\b/i,
    /^(\d{1,2})\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(\d{4})(?:[ T](\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?)?\b/i,
  ];

  const iso = text.match(patterns[0]);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (!validDate(year, month, day)) return '';
    const time = timeFrom(iso[4], iso[5], iso[6]);
    if (iso[4] && !time) return '';
    return formatWhen(year, month, day, time);
  }

  const us = text.match(patterns[1]);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    const year = Number(us[3]);
    if (!validDate(year, month, day)) return '';
    const time = timeFrom(us[4], us[5], us[6]);
    if (us[4] && !time) return '';
    return formatWhen(year, month, day, time);
  }

  const monthFirst = text.match(patterns[2]);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].toLowerCase()];
    const day = Number(monthFirst[2]);
    const year = Number(monthFirst[3]);
    if (!validDate(year, month, day)) return '';
    const time = timeFrom(monthFirst[4], monthFirst[5], monthFirst[6]);
    if (monthFirst[4] && !time) return '';
    return formatWhen(year, month, day, time);
  }

  const dayFirst = text.match(patterns[3]);
  if (dayFirst) {
    const day = Number(dayFirst[1]);
    const month = MONTHS[dayFirst[2].toLowerCase()];
    const year = Number(dayFirst[3]);
    if (!validDate(year, month, day)) return '';
    const time = timeFrom(dayFirst[4], dayFirst[5], dayFirst[6]);
    if (dayFirst[4] && !time) return '';
    return formatWhen(year, month, day, time);
  }

  return '';
}

function bookingToken(raw) {
  const token = String(raw || '').trim().split(/\s+/)[0].replace(/[.,;:]+$/g, '');
  if (!/^[A-Za-z0-9-]{5,10}$/.test(token)) return '';
  if (!/\d/.test(token) && !/^[A-Z0-9-]{5,8}$/.test(token)) return '';
  return token;
}

function cleanPlace(raw) {
  return String(raw || '').trim().replace(/[.,;]+$/g, '').trim();
}

function isPlace(raw) {
  const text = cleanPlace(raw);
  if (!text || text.length > 80) return false;
  if (/[.!?]/.test(text)) return false;
  const words = text.split(/\s+/);
  if (words.length > 8) return false;
  const meaningful = words.filter((word) => {
    const letters = word.toLowerCase().replace(/[^a-z0-9]/g, '');
    return letters && !PLACE_STOP.has(letters);
  });
  return meaningful.length > 0;
}

function labeled(line, pattern) {
  const match = line.match(pattern);
  if (!match) return '';
  return match[1].trim();
}

function remember(found, key, value) {
  if (!value || found[key]) return;
  found[key] = value;
}

function parseConfirmation(text, type) {
  const kind = String(type || '').trim().toLowerCase();
  const source = String(text || '').replace(/\r\n/g, '\n');
  const found = {};
  const lines = source.split('\n');

  const bookingLabel = /^(?:booking\s+reference|booking\s+ref|booking\s+id|booking\s+number|confirmation\s+code|confirmation\s+number|confirmation|record\s+locator|pnr|reservation\s+number|reservation\s+code)\b\s*[:#-]?\s*(.+)$/i;
  const hotelLabel = /^(?:hotel(?:\s+name)?|property)\b\s*[:#-]\s*(.+)$/i;
  const originLabel = /^(?:from|origin|departure\s+airport|departing\s+from|departs\s+from)\b\s*[:#-]\s*(.+)$/i;
  const destinationLabel = /^(?:to|destination|arrival\s+airport|arriving\s+at|arrives\s+at)\b\s*[:#-]\s*(.+)$/i;
  const flightStart = /^(?:departure|departs|depart|start)\b\s*[:#-]?\s*(.+)$/i;
  const flightEnd = /^(?:arrival|arrives|arrive|end)\b\s*[:#-]?\s*(.+)$/i;
  const hotelStart = /^(?:check-?in|check\s+in|arrival|arrives|arrive|start)\b\s*[:#-]?\s*(.+)$/i;
  const hotelEnd = /^(?:check-?out|check\s+out|departure|departs|depart|end)\b\s*[:#-]?\s*(.+)$/i;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const booking = bookingToken(labeled(line, bookingLabel));
    if (booking) remember(found, 'bookingReference', booking);

    if (kind === 'hotel') {
      const hotel = cleanPlace(labeled(line, hotelLabel));
      if (hotel && isPlace(hotel) && !parseWhen(hotel)) {
        remember(found, 'name', hotel);
      }
    }

    if (kind === 'flight') {
      const origin = cleanPlace(labeled(line, originLabel));
      if (origin && isPlace(origin) && !parseWhen(origin)) {
        remember(found, 'origin', origin);
      }
      const destination = cleanPlace(labeled(line, destinationLabel));
      if (destination && isPlace(destination) && !parseWhen(destination)) {
        remember(found, 'destination', destination);
      }
      const route = line.match(/^([A-Z]{3})\s*(?:to|->|→|–|-)\s*([A-Z]{3})$/);
      if (route) {
        remember(found, 'origin', route[1]);
        remember(found, 'destination', route[2]);
      }
    }

    const startLabel = kind === 'hotel' ? hotelStart : flightStart;
    const endLabel = kind === 'hotel' ? hotelEnd : flightEnd;
    const startValue = labeled(line, startLabel);
    if (startValue) {
      const when = parseWhen(startValue);
      if (when) remember(found, 'start', when);
      else if (kind === 'flight' && isPlace(startValue)) {
        remember(found, 'origin', cleanPlace(startValue));
      }
    }
    const endValue = labeled(line, endLabel);
    if (endValue) {
      const when = parseWhen(endValue);
      if (when) remember(found, 'end', when);
      else if (kind === 'flight' && isPlace(endValue)) {
        remember(found, 'destination', cleanPlace(endValue));
      }
    }
  }

  return found;
}

module.exports = { parseConfirmation };
