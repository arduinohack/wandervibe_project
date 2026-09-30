const API = 'http://localhost:3000';
const TOKEN_KEY = 'wandervibeAdminToken';
const USER_KEY = 'wandervibeAdminUser';
const ZONE_KEY = 'wandervibe.admin.timeZone';
const DELAY_KEY = 'wandervibe.admin.searchDelaySec';
const STYLES_KEY = 'wandervibe.admin.styles';
const STYLE_TYPES = ['banner', 'heading', 'label', 'input', 'button', 'table', 'error'];
const STYLE_FONTS = ['system-ui', 'Georgia', 'Times New Roman', 'Arial', 'Verdana', 'Consolas'];
const STYLE_LABELS = {
  banner: 'Banner',
  heading: 'Heading',
  label: 'Label',
  input: 'Input',
  button: 'Button',
  table: 'Table',
  error: 'Error',
};
const FONT_STACKS = {
  'system-ui': 'system-ui, sans-serif',
  Georgia: 'Georgia, serif',
  'Times New Roman': '"Times New Roman", Times, serif',
  Arial: 'Arial, sans-serif',
  Verdana: 'Verdana, sans-serif',
  Consolas: 'Consolas, monospace',
};
const STYLE_DEFAULTS = {
  banner: { font: 'Georgia', color: '#1c1915', size: 16 },
  heading: { font: 'Georgia', color: '#1c1915', size: 24 },
  label: { font: 'Georgia', color: '#1c1915', size: 14 },
  input: { font: 'Georgia', color: '#1c1915', size: 16 },
  button: { font: 'Georgia', color: '#f7f4ee', size: 16 },
  table: { font: 'Consolas', color: '#1c1915', size: 13 },
  error: { font: 'Georgia', color: '#8a2a1a', size: 16 },
};
const ZONE_CHOICES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'Europe/London',
];

const loginPanel = document.getElementById('login-panel');
const appPanel = document.getElementById('app-panel');
const logoutButton = document.getElementById('logout');
const loginError = document.getElementById('login-error');
const logsStatus = document.getElementById('logs-status');
const logsBody = document.getElementById('logs-body');
const deleteStatus = document.getElementById('delete-status');
const deletePlans = document.getElementById('delete-plans');
const appNav = document.getElementById('app-nav');
const logsPage = document.getElementById('logs-page');
const settingsPage = document.getElementById('settings-page');
const settingsStatus = document.getElementById('settings-status');
const zoneSelect = document.getElementById('display-time-zone');
const searchDelayInput = document.getElementById('search-delay');
const loginBanner = document.getElementById('login-banner');

let loadedLogs = [];
let selectedUserId = '';
let selectedUserEmail = '';
let userSearchTimer = 0;
let userSearchSeq = 0;

function token() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}

function storedUser() {
  const raw = sessionStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    const user = JSON.parse(raw);
    if (!user || typeof user !== 'object' || Array.isArray(user)) return null;
    return user;
  } catch (err) {
    return null;
  }
}

function saveSessionUser(user) {
  sessionStorage.setItem(USER_KEY, JSON.stringify({
    firstName: user && user.firstName ? String(user.firstName) : '',
    lastName: user && user.lastName ? String(user.lastName) : '',
    email: user && user.email ? String(user.email) : '',
  }));
}

function bannerText() {
  if (!token()) return '';
  const user = storedUser();
  if (!user) return '';
  const name = [user.firstName, user.lastName]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
  const email = String(user.email || '').trim();
  if (name && email) return `Logged in as ${name} (${email})`;
  if (name) return `Logged in as ${name}`;
  if (email) return `Logged in as ${email}`;
  return '';
}

function updateBanner() {
  const text = bannerText();
  loginBanner.textContent = text;
  loginBanner.hidden = !text;
}

function showLoggedIn(isIn) {
  loginPanel.hidden = isIn;
  appPanel.hidden = !isIn;
  logoutButton.hidden = !isIn;
  appNav.hidden = !isIn;
  updateBanner();
  if (isIn) showPage();
}

function isCssColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function styleFor(type, saved) {
  const base = { ...STYLE_DEFAULTS[type] };
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return base;
  if (STYLE_FONTS.includes(saved.font)) base.font = saved.font;
  if (isCssColor(saved.color)) base.color = saved.color;
  const size = Number(saved.size);
  if (Number.isFinite(size) && size >= 12 && size <= 28) base.size = size;
  return base;
}

function loadStyles() {
  let saved = {};
  const raw = localStorage.getItem(STYLES_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed;
    } catch (err) {
      saved = {};
    }
  }
  const styles = {};
  for (const type of STYLE_TYPES) styles[type] = styleFor(type, saved[type]);
  return styles;
}

function applyStyles(styles) {
  const root = document.documentElement;
  for (const type of STYLE_TYPES) {
    const style = styles[type];
    root.style.setProperty(`--wv-${type}-font`, FONT_STACKS[style.font]);
    root.style.setProperty(`--wv-${type}-color`, style.color);
    root.style.setProperty(`--wv-${type}-size`, `${style.size}px`);
  }
}

function fillStyleFields(styles) {
  const root = document.getElementById('style-fields');
  root.replaceChildren();
  for (const type of STYLE_TYPES) {
    const style = styles[type];
    const box = document.createElement('fieldset');
    box.className = 'style-type';
    const legend = document.createElement('legend');
    legend.textContent = STYLE_LABELS[type];
    box.appendChild(legend);

    const fontLabel = document.createElement('label');
    fontLabel.append('Font');
    const font = document.createElement('select');
    font.id = `style-${type}-font`;
    for (const name of STYLE_FONTS) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      font.appendChild(option);
    }
    font.value = style.font;
    fontLabel.appendChild(font);

    const colorLabel = document.createElement('label');
    colorLabel.append('Color');
    const color = document.createElement('input');
    color.type = 'color';
    color.id = `style-${type}-color`;
    color.value = style.color;
    colorLabel.appendChild(color);

    const sizeLabel = document.createElement('label');
    sizeLabel.append('Size (px)');
    const size = document.createElement('input');
    size.type = 'number';
    size.id = `style-${type}-size`;
    size.min = '12';
    size.max = '28';
    size.step = 'any';
    size.value = String(style.size);
    sizeLabel.appendChild(size);

    box.append(fontLabel, colorLabel, sizeLabel);
    root.appendChild(box);
  }
}

function stylesFromForm() {
  const styles = {};
  for (const type of STYLE_TYPES) {
    const font = document.getElementById(`style-${type}-font`).value;
    const color = document.getElementById(`style-${type}-color`).value;
    const size = Number(document.getElementById(`style-${type}-size`).value);
    if (!STYLE_FONTS.includes(font) || !isCssColor(color) || !Number.isFinite(size) || size < 12 || size > 28) {
      return null;
    }
    styles[type] = { font, color, size };
  }
  return styles;
}

function isValidZone(zone) {
  if (!zone) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: zone }).format(new Date());
    return true;
  } catch (err) {
    return false;
  }
}

function browserZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidZone(zone) ? zone : 'UTC';
  } catch (err) {
    return 'UTC';
  }
}

function savedZone() {
  const saved = localStorage.getItem(ZONE_KEY);
  if (saved && ZONE_CHOICES.includes(saved) && isValidZone(saved)) return saved;
  return '';
}

function displayTimeZone() {
  return savedZone() || browserZone();
}

function searchDelaySec() {
  const raw = localStorage.getItem(DELAY_KEY);
  if (raw == null || String(raw).trim() === '') return 2;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0.5 || value > 10) return 2;
  return value;
}

function zoneAbbreviation(zone) {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      timeZoneName: 'short',
    }).formatToParts(new Date());
    const name = parts.find((part) => part.type === 'timeZoneName');
    return name && name.value ? name.value : zone;
  } catch (err) {
    return zone;
  }
}

function updateCreatedAtHeader() {
  const header = document.getElementById('created-at-header');
  if (!header) return;
  header.textContent = `createdAt (${zoneAbbreviation(displayTimeZone())})`;
}

function fillZoneSelect() {
  zoneSelect.replaceChildren();
  const browser = document.createElement('option');
  browser.value = '';
  browser.textContent = 'Browser default';
  zoneSelect.appendChild(browser);
  for (const zone of ZONE_CHOICES) {
    const option = document.createElement('option');
    option.value = zone;
    option.textContent = zone;
    zoneSelect.appendChild(option);
  }
  zoneSelect.value = savedZone();
}

function formatCreatedAt(value) {
  if (value == null || value === '') return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: displayTimeZone(),
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    }).format(date);
  } catch (err) {
    return String(value);
  }
}

function showPage() {
  const page = location.hash === '#settings' ? 'settings' : 'logs';
  logsPage.hidden = page !== 'logs';
  settingsPage.hidden = page !== 'settings';
  for (const link of appNav.querySelectorAll('a')) {
    const active = link.getAttribute('href') === `#${page}`;
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  updateCreatedAtHeader();
  if (page === 'logs' && loadedLogs.length) renderLogs(loadedLogs);
}

async function readBody(response) {
  if (response.status === 204) return {};
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (err) {
    return {};
  }
}

function messageFrom(body, fallback) {
  if (body && typeof body.message === 'string' && body.message) return body.message;
  if (body && typeof body.msg === 'string' && body.msg) return body.msg;
  return fallback;
}

document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  let response;
  try {
    response = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch (err) {
    loginError.textContent = 'Could not reach the API.';
    return;
  }
  const body = await readBody(response);
  const role = body.user && body.user.role;
  if (!response.ok || role !== 'admin' || !body.token) {
    clearToken();
    loginError.textContent = role && role !== 'admin'
      ? 'This account is not an admin.'
      : messageFrom(body, 'Login failed.');
    showLoggedIn(false);
    return;
  }
  sessionStorage.setItem(TOKEN_KEY, body.token);
  saveSessionUser(body.user);
  showLoggedIn(true);
  document.getElementById('password').value = '';
  loadLogs();
});

function hideUserResults() {
  for (const list of document.querySelectorAll('.user-picker-results')) {
    list.hidden = true;
    list.replaceChildren();
  }
}

function clearSelectedUser() {
  clearTimeout(userSearchTimer);
  userSearchSeq += 1;
  selectedUserId = '';
  selectedUserEmail = '';
  const idField = document.getElementById('delete-user-id');
  if (idField) idField.value = '';
  for (const input of document.querySelectorAll('.user-picker-query')) input.value = '';
  for (const chosen of document.querySelectorAll('.user-picker-chosen')) chosen.textContent = '';
  hideUserResults();
}

function showPickerNote(list, text) {
  list.replaceChildren();
  const item = document.createElement('li');
  item.className = 'user-picker-note';
  item.textContent = text;
  list.appendChild(item);
  list.hidden = false;
}

function chooseUser(user) {
  selectedUserId = user && user._id != null ? String(user._id) : '';
  selectedUserEmail = user && user.email != null ? String(user.email) : '';
  document.getElementById('delete-user-id').value = selectedUserId;
  for (const input of document.querySelectorAll('.user-picker-query')) input.value = selectedUserEmail;
  const label = selectedUserEmail ? `Selected ${selectedUserEmail}` : '';
  for (const chosen of document.querySelectorAll('.user-picker-chosen')) chosen.textContent = label;
  hideUserResults();
}

async function searchUsers(input, q) {
  const list = input.closest('.user-picker').querySelector('.user-picker-results');
  if (input.value.trim() !== q) return;
  const seq = ++userSearchSeq;
  let response;
  try {
    response = await fetch(`${API}/api/admin/users?q=${encodeURIComponent(q)}`, {
      headers: authHeaders(),
    });
  } catch (err) {
    if (seq !== userSearchSeq) return;
    showPickerNote(list, 'Could not reach the API.');
    return;
  }
  if (seq !== userSearchSeq) return;
  const body = await readBody(response);
  if (seq !== userSearchSeq) return;
  if (response.status === 401) {
    clearToken();
    clearSelectedUser();
    showLoggedIn(false);
    loginError.textContent = messageFrom(body, 'Login expired.');
    return;
  }
  if (!response.ok) {
    showPickerNote(list, messageFrom(body, 'Could not search users.'));
    return;
  }
  const users = Array.isArray(body.users) ? body.users : [];
  if (!users.length) {
    showPickerNote(list, 'No matches.');
    return;
  }
  list.replaceChildren();
  for (const user of users) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'option');
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
    button.textContent = name ? `${user.email} — ${name}` : String(user.email || '');
    button.addEventListener('click', () => chooseUser(user));
    item.appendChild(button);
    list.appendChild(item);
  }
  list.hidden = false;
}

function scheduleUserSearch(input) {
  clearTimeout(userSearchTimer);
  const list = input.closest('.user-picker').querySelector('.user-picker-results');
  const q = input.value.trim();
  if (q.length < 2) {
    list.hidden = true;
    list.replaceChildren();
    return;
  }
  userSearchTimer = setTimeout(() => searchUsers(input, q), searchDelaySec() * 1000);
}

for (const input of document.querySelectorAll('.user-picker-query')) {
  input.addEventListener('input', () => {
    selectedUserId = '';
    selectedUserEmail = '';
    document.getElementById('delete-user-id').value = '';
    for (const chosen of document.querySelectorAll('.user-picker-chosen')) chosen.textContent = '';
    for (const other of document.querySelectorAll('.user-picker-query')) {
      if (other !== input) other.value = '';
    }
    scheduleUserSearch(input);
  });
}

document.addEventListener('pointerdown', (event) => {
  if (event.target.closest('.user-picker')) return;
  hideUserResults();
});

logoutButton.addEventListener('click', () => {
  clearToken();
  clearSelectedUser();
  loadedLogs = [];
  logsBody.replaceChildren();
  logsStatus.textContent = '';
  deleteStatus.textContent = '';
  deleteStatus.classList.remove('is-error');
  deletePlans.replaceChildren();
  showLoggedIn(false);
});

document.getElementById('settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const zone = zoneSelect.value;
  const delay = Number(searchDelayInput.value);
  if (zone && !isValidZone(zone)) {
    settingsStatus.classList.add('is-error');
    settingsStatus.textContent = 'Choose a valid time zone.';
    return;
  }
  if (!Number.isFinite(delay) || delay < 0.5 || delay > 10) {
    settingsStatus.classList.add('is-error');
    settingsStatus.textContent = 'Search delay must be a number from 0.5 to 10 seconds.';
    return;
  }
  const styles = stylesFromForm();
  if (!styles) {
    settingsStatus.classList.add('is-error');
    settingsStatus.textContent = 'Each text style needs a listed font, a color, and a size from 12 to 28.';
    return;
  }
  localStorage.setItem(ZONE_KEY, zone);
  localStorage.setItem(DELAY_KEY, String(delay));
  localStorage.setItem(STYLES_KEY, JSON.stringify(styles));
  applyStyles(styles);
  settingsStatus.classList.remove('is-error');
  const label = zone ? zone : `Browser default (${browserZone()})`;
  const delayLabel = delay === 1 ? '1 second' : `${delay} seconds`;
  settingsStatus.textContent = `Display time zone is ${label}. Search delay is ${delayLabel}. Text styles saved.`;
  updateCreatedAtHeader();
  if (loadedLogs.length) renderLogs(loadedLogs);
});

window.addEventListener('hashchange', () => {
  if (token()) showPage();
});

function authHeaders() {
  return {
    Authorization: `Bearer ${token()}`,
    'Content-Type': 'application/json',
  };
}

async function loadLogs() {
  logsStatus.classList.remove('is-error');
  logsStatus.textContent = '';
  logsBody.replaceChildren();
  const params = new URLSearchParams();
  const eventName = document.getElementById('filter-event').value.trim();
  const planId = document.getElementById('filter-plan').value.trim();
  if (eventName) params.set('event', eventName);
  if (planId) params.set('planId', planId);
  if (selectedUserId) params.set('userId', selectedUserId);
  const query = params.toString();
  const url = `${API}/api/admin/logs${query ? `?${query}` : ''}`;
  let response;
  try {
    response = await fetch(url, { headers: authHeaders() });
  } catch (err) {
    logsStatus.classList.add('is-error');
    logsStatus.textContent = 'Could not reach the API.';
    return;
  }
  const body = await readBody(response);
  if (response.status === 401) {
    clearToken();
    showLoggedIn(false);
    loginError.textContent = messageFrom(body, 'Login expired.');
    return;
  }
  if (!response.ok) {
    logsStatus.classList.add('is-error');
    logsStatus.textContent = messageFrom(body, 'Could not load logs.');
    return;
  }
  loadedLogs = Array.isArray(body.logs) ? body.logs : [];
  renderLogs(loadedLogs);
}

function renderLogs(logs) {
  updateCreatedAtHeader();
  logsBody.replaceChildren();
  if (!logs.length) {
    logsStatus.textContent = logsStatus.classList.contains('is-error') ? logsStatus.textContent : 'No logs.';
    return;
  }
  logsStatus.textContent = '';
  for (const row of logs) {
    const tr = document.createElement('tr');
    for (const key of ['createdAt', 'event', 'level', 'actorUserId', 'planId', 'message']) {
      const cell = document.createElement('td');
      const value = row[key];
      cell.textContent = key === 'createdAt' ? formatCreatedAt(value) : (value == null ? '' : String(value));
      tr.appendChild(cell);
    }
    logsBody.appendChild(tr);
  }
}

document.getElementById('logs-form').addEventListener('submit', (event) => {
  event.preventDefault();
  loadLogs();
});

document.getElementById('delete-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  deleteStatus.classList.remove('is-error');
  deleteStatus.textContent = '';
  deletePlans.replaceChildren();
  const userId = selectedUserId;
  if (!userId) {
    deleteStatus.classList.add('is-error');
    deleteStatus.textContent = 'Choose a user by email.';
    return;
  }
  const who = selectedUserEmail || userId;
  if (!window.confirm(`Delete user ${who}?`)) return;
  let response;
  try {
    response = await fetch(`${API}/api/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
  } catch (err) {
    deleteStatus.classList.add('is-error');
    deleteStatus.textContent = 'Could not reach the API.';
    return;
  }
  const body = await readBody(response);
  if (response.status === 401) {
    clearToken();
    showLoggedIn(false);
    loginError.textContent = messageFrom(body, 'Login expired.');
    return;
  }
  if (response.status === 409) {
    deleteStatus.classList.add('is-error');
    deleteStatus.textContent = messageFrom(body, 'Delete was blocked.');
    const plans = Array.isArray(body.plans) ? body.plans : [];
    for (const plan of plans) {
      const item = document.createElement('li');
      const name = plan && plan.name ? plan.name : 'Plan';
      const id = plan && plan._id ? plan._id : '';
      item.textContent = id ? `${name} (${id})` : name;
      deletePlans.appendChild(item);
    }
    return;
  }
  if (response.status === 200 || response.status === 204) {
    deleteStatus.textContent = messageFrom(body, 'User deleted');
    clearSelectedUser();
    return;
  }
  deleteStatus.classList.add('is-error');
  deleteStatus.textContent = messageFrom(body, 'Delete failed.');
});

fillZoneSelect();
searchDelayInput.value = String(searchDelaySec());
const initialStyles = loadStyles();
applyStyles(initialStyles);
fillStyleFields(initialStyles);
showLoggedIn(Boolean(token()));
if (token()) loadLogs();
