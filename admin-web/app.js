const API = 'http://localhost:3000';
const TOKEN_KEY = 'wandervibeAdminToken';
const ZONE_KEY = 'wandervibe.admin.timeZone';
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
}

function showLoggedIn(isIn) {
  loginPanel.hidden = isIn;
  appPanel.hidden = !isIn;
  logoutButton.hidden = !isIn;
  appNav.hidden = !isIn;
  if (isIn) showPage();
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
  userSearchTimer = setTimeout(() => searchUsers(input, q), 300);
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
  if (zone && !isValidZone(zone)) {
    settingsStatus.classList.add('is-error');
    settingsStatus.textContent = 'Choose a valid time zone.';
    return;
  }
  localStorage.setItem(ZONE_KEY, zone);
  settingsStatus.classList.remove('is-error');
  const label = zone ? zone : `Browser default (${browserZone()})`;
  settingsStatus.textContent = `Display time zone is ${label}.`;
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
showLoggedIn(Boolean(token()));
if (token()) loadLogs();
