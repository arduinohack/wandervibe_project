const fs = require('fs/promises');
const path = require('path');

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PER_ACTIVITY = 5;
const DEFAULT_UPLOAD_DIR = '/opt/wandervibe/uploads';

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'application/pdf': '.pdf',
};

const EXT_ALIASES = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'image/heic': ['.heic'],
  'image/heif': ['.heif', '.heic'],
  'application/pdf': ['.pdf'],
};

const HEIF_BRANDS = new Set([
  'heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'heif', 'mif1', 'msf1',
]);

function uploadRoot() {
  const configured = process.env.UPLOAD_DIR;
  if (typeof configured === 'string' && configured.trim()) {
    return path.resolve(configured.trim());
  }
  return path.resolve(DEFAULT_UPLOAD_DIR);
}

function sniffedMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return '';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
  ) return 'image/png';
  const head6 = buffer.slice(0, 6).toString('ascii');
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'image/gif';
  if (
    buffer.length >= 12
    && buffer.slice(0, 4).toString('ascii') === 'RIFF'
    && buffer.slice(8, 12).toString('ascii') === 'WEBP'
  ) return 'image/webp';
  if (buffer.length >= 12 && buffer.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.slice(8, 12).toString('ascii').toLowerCase();
    if (HEIF_BRANDS.has(brand)) {
      return brand.startsWith('hei') ? 'image/heic' : 'image/heif';
    }
  }
  const prefix = buffer.slice(0, Math.min(buffer.length, 5)).toString('ascii');
  if (prefix === '%PDF-') return 'application/pdf';
  return '';
}

function safeFilename(original, mime) {
  const ext = EXT_BY_MIME[mime] || '';
  const base = path.basename(String(original || ''))
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let name = base === '.' || base === '..' ? '' : base;
  if (!name) return `attachment${ext}`;
  const aliases = EXT_ALIASES[mime] || [];
  const lower = name.toLowerCase();
  if (!aliases.some((suffix) => lower.endsWith(suffix))) {
    name = name.replace(/\.[^.]+$/, '');
    name = `${name}${ext}`;
  }
  if (name.length > 180) name = name.slice(0, 180).trim();
  return name || `attachment${ext}`;
}

function storageKeyFor(id) {
  const text = String(id || '').trim().toLowerCase();
  return `${text.slice(0, 2)}/${text.slice(2, 4)}/${text}`;
}

function absolutePath(storageKey) {
  const key = String(storageKey || '');
  if (!key || key.includes('\\') || key.includes('\0')) return null;
  const parts = key.split('/');
  if (!parts.length || parts.some((part) => !part || part === '.' || part === '..')) return null;
  const root = uploadRoot();
  const full = path.resolve(root, ...parts);
  const relative = path.relative(root, full);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return full;
}

async function saveBuffer(storageKey, buffer) {
  const full = absolutePath(storageKey);
  if (!full) {
    const error = new Error('Invalid storage key');
    error.status = 500;
    throw error;
  }
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer, { flag: 'wx' });
  return full;
}

async function removeStored(storageKey) {
  const full = absolutePath(storageKey);
  if (!full) return;
  try {
    await fs.unlink(full);
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
  }
}

function contentDisposition(filename) {
  const name = String(filename || 'attachment');
  const ascii = name.replace(/[^\x20-\x7E]/g, ' ').replace(/["\\]/g, ' ');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

const ALLOWED_MIMES = Object.keys(EXT_BY_MIME);

module.exports = {
  MAX_BYTES,
  MAX_PER_ACTIVITY,
  ALLOWED_MIMES,
  DEFAULT_UPLOAD_DIR,
  uploadRoot,
  sniffedMime,
  safeFilename,
  storageKeyFor,
  absolutePath,
  saveBuffer,
  removeStored,
  contentDisposition,
};
