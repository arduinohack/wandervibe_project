const API = 'http://192.168.1.140:3001';
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

// SupportLog event strings the mounted API already writes. Activity routes use
// /api/activities. PlanCreated and UserDeleted stay. A loaded row can still add
// an older name such as POST /api/events. Stored rows are not rewritten.
const KNOWN_EVENTS = [
  'DELETE /api/activities/:id',
  'DELETE /api/admin/users/:userId',
  'GET /api/activities/:id/history',
  'GET /api/activities/plan/:planId',
  'GET /api/admin/users',
  'GET /api/admin/users/:userId',
  'GET /api/invites',
  'GET /api/plans',
  'GET /api/plans/:planId/itinerary',
  'GET /api/plans/:planId/users',
  'PATCH /api/auth/users/:userId',
  'POST /api/activities',
  'POST /api/activities/:id/restore',
  'POST /api/auth/forgot-password',
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'POST /api/auth/register',
  'POST /api/auth/reset-password',
  'POST /api/auth/verify-token',
  'POST /api/invites/invitations/:invitationId/respond',
  'POST /api/plans',
  'POST /api/plans/:planId/invite',
  'POST /api/plans/:planId/reassign-coordinator',
  'POST /api/plans/:planId/remove-user',
  'PUT /api/activities/:id',
  'PlanCreated',
  'UserDeleted',
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
let logUserId = '';
let explorerSeq = 0;
let userSearchTimer = 0;
let userSearchSeq = 0;
let eventOptions = KNOWN_EVENTS.slice();
let planMenu = null;
let accountMenu = null;

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
  header.textContent = `createdAt (TZ: ${zoneAbbreviation(displayTimeZone())})`;
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
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: displayTimeZone(),
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const part = (type) => {
      const found = parts.find((item) => item.type === type);
      return found && found.value ? found.value.padStart(2, '0') : '';
    };
    return `${part('month')}/${part('day')}/${part('year')} ${part('hour')}:${part('minute')}:${part('second')}`;
  } catch (err) {
    return String(value);
  }
}

const STATUS_PHRASES = {
  200: 'OK',
  201: 'Created',
  204: 'No content',
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  500: 'Server error',
};

const MESSAGE_OVERRIDES = {
  'POST /api/auth/login': {
    200: 'Signed in',
    400: 'Login rejected',
  },
  'GET /api/admin/users': {
    200: 'Account search',
  },
  'GET /api/admin/users/:userId': {
    200: 'Opened account',
  },
  'DELETE /api/admin/users/:userId': {
    409: 'Delete blocked',
  },
  'GET /api/plans': {
    401: 'Plans list denied',
  },
};

function statusCodeFrom(message) {
  if (typeof message === 'number' && Number.isInteger(message)) return message;
  const text = String(message == null ? '' : message).trim();
  if (!/^\d{3}$/.test(text)) return null;
  return Number(text);
}

function formatLogMessage(event, message) {
  const code = statusCodeFrom(message);
  if (code == null) return message == null ? '' : String(message);
  const overrides = MESSAGE_OVERRIDES[event] || {};
  const phrase = overrides[code] || STATUS_PHRASES[code] || 'Response';
  return `${phrase} (${code})`;
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
  logUserId = '';
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
  logUserId = selectedUserId;
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
    button.addEventListener('click', () => {
      chooseUser(user);
      if (input.id === 'admin-account-filter') openExplorer(user && user._id);
    });
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
    logUserId = '';
    document.getElementById('delete-user-id').value = '';
    for (const chosen of document.querySelectorAll('.user-picker-chosen')) chosen.textContent = '';
    for (const other of document.querySelectorAll('.user-picker-query')) {
      if (other !== input) other.value = '';
    }
    scheduleUserSearch(input);
  });
}

for (const button of document.querySelectorAll('.user-picker-clear')) {
  button.addEventListener('click', () => clearSelectedUser());
}

document.getElementById('clear-account-filter').addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  clearTimeout(userSearchTimer);
  userSearchSeq += 1;
  logUserId = '';
  const account = document.getElementById('admin-account-filter');
  if (account) account.value = '';
  const picker = account && account.closest('.user-picker');
  if (picker) {
    const chosen = picker.querySelector('.user-picker-chosen');
    if (chosen) chosen.textContent = '';
    const list = picker.querySelector('.user-picker-results');
    if (list) {
      list.hidden = true;
      list.replaceChildren();
    }
  }
});

document.getElementById('clear-plan-filter').addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  document.getElementById('filter-plan').value = '';
});

function loadLogsOnEnter(event) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  loadLogs();
}

document.getElementById('admin-account-filter').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  clearTimeout(userSearchTimer);
  userSearchSeq += 1;
  const picker = event.target.closest('.user-picker');
  const list = picker && picker.querySelector('.user-picker-results');
  if (list) {
    list.hidden = true;
    list.replaceChildren();
  }
  loadLogs();
});

document.getElementById('filter-plan').addEventListener('keydown', loadLogsOnEnter);

document.addEventListener('pointerdown', (event) => {
  if (planMenu && !planMenu.contains(event.target)) closePlanMenu();
  if (accountMenu && !accountMenu.contains(event.target)) closeAccountMenu();
  if (event.target.closest('.user-picker')) return;
  hideUserResults();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closePlanMenu();
    closeAccountMenu();
  }
});

function clearExplorer() {
  explorerSeq += 1;
  const section = document.getElementById('explorer');
  const status = document.getElementById('explorer-status');
  const fields = document.getElementById('explorer-fields');
  const plans = document.getElementById('explorer-plans');
  if (section) section.hidden = true;
  if (status) status.textContent = '';
  if (fields) fields.replaceChildren();
  if (plans) plans.replaceChildren();
}

function explorerDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function renderExplorer(account) {
  const fields = document.getElementById('explorer-fields');
  const plansBody = document.getElementById('explorer-plans');
  const rows = [
    ['Email', account.email],
    ['First name', account.firstName],
    ['Last name', account.lastName],
    ['Phone', account.phoneNumber],
    ['Role', account.role],
  ];
  fields.replaceChildren();
  for (const [label, value] of rows) {
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = value == null ? '' : String(value);
    fields.append(term, detail);
  }
  plansBody.replaceChildren();
  const plans = Array.isArray(account.plans) ? account.plans : [];
  for (const plan of plans) {
    const row = document.createElement('tr');
    for (const value of [
      plan.name,
      plan.type,
      plan.role,
      explorerDate(plan.startDate),
      explorerDate(plan.endDate),
      plan._id,
    ]) {
      const cell = document.createElement('td');
      cell.textContent = value == null ? '' : String(value);
      row.appendChild(cell);
    }
    plansBody.appendChild(row);
  }
}

async function openExplorer(userId) {
  const id = userId == null ? '' : String(userId);
  const section = document.getElementById('explorer');
  const status = document.getElementById('explorer-status');
  const fields = document.getElementById('explorer-fields');
  const plansBody = document.getElementById('explorer-plans');
  if (!section || !id) return;
  const seq = ++explorerSeq;
  section.hidden = false;
  status.textContent = 'Loading account.';
  fields.replaceChildren();
  plansBody.replaceChildren();
  let response;
  try {
    response = await fetch(`${API}/api/admin/users/${encodeURIComponent(id)}`, {
      headers: authHeaders(),
    });
  } catch (err) {
    if (seq !== explorerSeq) return;
    status.textContent = 'Could not reach the API.';
    return;
  }
  if (seq !== explorerSeq) return;
  const body = await readBody(response);
  if (seq !== explorerSeq) return;
  if (response.status === 401) {
    clearToken();
    clearSelectedUser();
    clearExplorer();
    showLoggedIn(false);
    loginError.textContent = messageFrom(body, 'Login expired.');
    return;
  }
  if (!response.ok) {
    status.textContent = messageFrom(body, 'Could not open this account.');
    return;
  }
  status.textContent = Array.isArray(body.plans) && body.plans.length ? '' : 'No plans.';
  renderExplorer(body);
}

logoutButton.addEventListener('click', () => {
  clearToken();
  clearSelectedUser();
  clearExplorer();
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

function renderEventOptions() {
  const select = document.getElementById('filter-event');
  const current = select.value;
  select.replaceChildren();
  const any = document.createElement('option');
  any.value = '';
  any.textContent = 'Any event';
  select.appendChild(any);
  for (const name of eventOptions) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }
  select.value = eventOptions.includes(current) ? current : '';
}

function rememberEvents(logs) {
  let added = false;
  for (const row of logs) {
    const name = row && row.event != null ? String(row.event).trim() : '';
    if (!name || eventOptions.includes(name)) continue;
    eventOptions.push(name);
    added = true;
  }
  if (added) renderEventOptions();
}

function closePlanMenu() {
  if (!planMenu) return;
  planMenu.remove();
  planMenu = null;
}

function copyText(value) {
  const text = String(value);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => copyTextFallback(text));
    return;
  }
  copyTextFallback(text);
}

function copyTextFallback(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '0';
  area.style.width = '1px';
  area.style.height = '1px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

function copyPlanId(planId) {
  copyText(planId);
}

function closeAccountMenu() {
  if (!accountMenu) return;
  accountMenu.remove();
  accountMenu = null;
}

function placeContextMenu(menu, x, y) {
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function openAccountMenu(x, y, email, actorUserId) {
  closePlanMenu();
  closeAccountMenu();
  const menu = document.createElement('ul');
  menu.className = 'plan-menu';
  menu.setAttribute('role', 'menu');
  const actions = [
    ['Set account filter', () => {
      clearTimeout(userSearchTimer);
      userSearchSeq += 1;
      logUserId = actorUserId;
      const input = document.getElementById('admin-account-filter');
      if (input) input.value = email;
      const picker = input && input.closest('.user-picker');
      if (picker) {
        const chosen = picker.querySelector('.user-picker-chosen');
        if (chosen) chosen.textContent = email ? `Selected ${email}` : '';
        const list = picker.querySelector('.user-picker-results');
        if (list) {
          list.hidden = true;
          list.replaceChildren();
        }
      }
      closeAccountMenu();
    }],
    ['Copy email', () => {
      copyText(email);
      closeAccountMenu();
    }],
  ];
  for (const [label, onClick] of actions) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.textContent = label;
    button.addEventListener('click', onClick);
    item.appendChild(button);
    menu.appendChild(item);
  }
  placeContextMenu(menu, x, y);
  accountMenu = menu;
}

function openPlanMenu(x, y, planId) {
  closeAccountMenu();
  closePlanMenu();
  const menu = document.createElement('ul');
  menu.className = 'plan-menu';
  menu.setAttribute('role', 'menu');
  const actions = [
    ['Set plan id filter', () => {
      document.getElementById('filter-plan').value = planId;
      closePlanMenu();
      loadLogs();
    }],
    ['Copy plan id', () => {
      copyPlanId(planId);
      closePlanMenu();
    }],
  ];
  for (const [label, onClick] of actions) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.textContent = label;
    button.addEventListener('click', onClick);
    item.appendChild(button);
    menu.appendChild(item);
  }
  placeContextMenu(menu, x, y);
  planMenu = menu;
}

async function loadLogs() {
  closePlanMenu();
  closeAccountMenu();
  logsStatus.classList.remove('is-error');
  logsStatus.textContent = '';
  logsBody.replaceChildren();
  const params = new URLSearchParams();
  const eventName = document.getElementById('filter-event').value.trim();
  const planId = document.getElementById('filter-plan').value.trim();
  if (eventName) params.set('event', eventName);
  if (planId) params.set('planId', planId);
  if (logUserId) params.set('userId', logUserId);
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
  rememberEvents(loadedLogs);
  renderLogs(loadedLogs);
}

function cellText(value) {
  return value == null ? '' : String(value);
}

function appendAccountCell(tr, email, actorUserId) {
  const cell = document.createElement('td');
  const label = cellText(email).trim();
  cell.textContent = cellText(email);
  const id = cellText(actorUserId).trim();
  if (id) cell.title = id;
  if (label) {
    cell.addEventListener('contextmenu', (menuEvent) => {
      menuEvent.preventDefault();
      openAccountMenu(menuEvent.clientX, menuEvent.clientY, label, id);
    });
  }
  tr.appendChild(cell);
}

function appendNamedIdCell(tr, name, idValue, onContextMenu) {
  const cell = document.createElement('td');
  cell.textContent = cellText(name);
  const id = cellText(idValue).trim();
  if (id) {
    cell.title = id;
    if (onContextMenu) {
      cell.addEventListener('contextmenu', (menuEvent) => {
        menuEvent.preventDefault();
        onContextMenu(menuEvent, id);
      });
    }
  }
  tr.appendChild(cell);
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
    const actorUserId = cellText(row.actorUserId).trim();
    const planId = cellText(row.planId).trim();
    if (actorUserId) tr.dataset.actorUserId = actorUserId;
    if (planId) tr.dataset.planId = planId;
    for (const key of ['createdAt', 'event', 'level']) {
      const cell = document.createElement('td');
      const value = row[key];
      cell.textContent = key === 'createdAt' ? formatCreatedAt(value) : cellText(value);
      tr.appendChild(cell);
    }
    appendAccountCell(tr, row.actorEmail, row.actorUserId);
    appendNamedIdCell(tr, row.planName, row.planId, (menuEvent, planId) => {
      openPlanMenu(menuEvent.clientX, menuEvent.clientY, planId);
    });
    const messageCell = document.createElement('td');
    messageCell.textContent = formatLogMessage(row.event, row.message);
    tr.appendChild(messageCell);
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

renderEventOptions();
fillZoneSelect();
searchDelayInput.value = String(searchDelaySec());
const initialStyles = loadStyles();
applyStyles(initialStyles);
fillStyleFields(initialStyles);
showLoggedIn(Boolean(token()));
if (token()) loadLogs();
