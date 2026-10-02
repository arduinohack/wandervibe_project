const API_KEY = 'wandervibe.import.api';
const TOKEN_KEY = 'wandervibe.import.token';
const USER_KEY = 'wandervibe.import.userId';
const DEFAULT_API = 'http://localhost:3000';

const apiBaseInput = document.getElementById('api-base');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginButton = document.getElementById('login-button');
const logoutButton = document.getElementById('logout-button');
const sessionForm = document.getElementById('session-form');
const importForm = document.getElementById('import-form');
const planSelect = document.getElementById('plan-select');
const fileInput = document.getElementById('csv-file');
const message = document.getElementById('message');
const planList = document.getElementById('plan-list');

apiBaseInput.value = localStorage.getItem(API_KEY) || DEFAULT_API;

function apiBase() {
  return apiBaseInput.value.trim().replace(/\/+$/, '') || DEFAULT_API;
}

function setMessage(text, isError) {
  message.textContent = text || '';
  message.className = isError ? 'message error' : 'message';
}

function authHeaders() {
  return { Authorization: `Bearer ${sessionStorage.getItem(TOKEN_KEY) || ''}` };
}

function canImport(role) {
  return role === 'Owner'
    || role === 'Collaborator'
    || role === 'VibeCoordinator'
    || role === 'coordinator'
    || role === 'VibePlanner'
    || role === 'planner';
}

function showSession(loggedIn) {
  loginButton.hidden = loggedIn;
  emailInput.hidden = loggedIn;
  passwordInput.hidden = loggedIn;
  emailInput.parentElement.hidden = loggedIn;
  passwordInput.parentElement.hidden = loggedIn;
  logoutButton.hidden = !loggedIn;
  if (!loggedIn) {
    importForm.hidden = true;
    planSelect.replaceChildren();
    planList.replaceChildren();
  }
}

function endSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  showSession(false);
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (err) {
    return {};
  }
}

async function storedRole(plan, userId) {
  if (plan.ownerId && String(plan.ownerId) === userId) return 'Owner';
  const response = await fetch(`${apiBase()}/api/plans/${plan._id}/users`, {
    headers: authHeaders(),
  });
  if (response.status === 401) return null;
  if (!response.ok) return '';
  const body = await readJson(response);
  const users = Array.isArray(body.users) ? body.users : [];
  const mine = users.find((row) => String(row.userId) === userId);
  return mine && mine.role ? String(mine.role) : '';
}

function renderPlans(rows) {
  planList.replaceChildren();
  planSelect.replaceChildren();
  const importable = rows.filter((row) => canImport(row.role));
  for (const row of importable) {
    const option = document.createElement('option');
    option.value = row.plan._id;
    option.textContent = row.plan.name || row.plan._id;
    planSelect.appendChild(option);
  }
  importForm.hidden = importable.length === 0;

  if (!rows.length) {
    const item = document.createElement('li');
    item.textContent = 'No plans yet';
    planList.appendChild(item);
    return;
  }

  for (const row of rows) {
    const item = document.createElement('li');
    const name = row.plan.name || 'Untitled plan';
    item.textContent = row.role ? `${name} (${row.role})` : name;
    planList.appendChild(item);
  }
}

async function loadPlans() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const userId = sessionStorage.getItem(USER_KEY);
  if (!token || !userId) {
    showSession(false);
    return;
  }
  showSession(true);
  const response = await fetch(`${apiBase()}/api/plans`, { headers: authHeaders() });
  if (response.status === 401) {
    endSession();
    setMessage('Log in again.', true);
    return;
  }
  if (!response.ok) {
    setMessage('Could not load plans.', true);
    return;
  }
  const body = await readJson(response);
  const plans = Array.isArray(body.plans) ? body.plans : [];
  const rows = [];
  for (const plan of plans) {
    const role = await storedRole(plan, userId);
    if (role === null) {
      endSession();
      setMessage('Log in again.', true);
      return;
    }
    rows.push({ plan, role });
  }
  renderPlans(rows);
}

sessionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  localStorage.setItem(API_KEY, apiBase());
  setMessage('Logging in…');
  const response = await fetch(`${apiBase()}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: emailInput.value.trim(),
      password: passwordInput.value,
    }),
  });
  const body = await readJson(response);
  if (!response.ok || !body.token) {
    setMessage(body.message || 'Login failed.', true);
    return;
  }
  const userId = body.user && (body.user._id || body.user.id);
  sessionStorage.setItem(TOKEN_KEY, body.token);
  sessionStorage.setItem(USER_KEY, userId ? String(userId) : '');
  passwordInput.value = '';
  setMessage('');
  await loadPlans();
});

logoutButton.addEventListener('click', () => {
  endSession();
  setMessage('');
});

apiBaseInput.addEventListener('change', () => {
  localStorage.setItem(API_KEY, apiBase());
});

importForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const planId = planSelect.value;
  const file = fileInput.files && fileInput.files[0];
  if (!planId) {
    setMessage('Choose a plan.', true);
    return;
  }
  if (!file) {
    setMessage('Choose a CSV file.', true);
    return;
  }
  const filename = file.name.toLowerCase();
  if (!filename.endsWith('.csv') || filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
    setMessage('Choose a CSV file. Spreadsheet files are not accepted.', true);
    return;
  }
  const nameColumn = document.getElementById('col-name').value.trim();
  if (!nameColumn) {
    setMessage('Enter the name column.', true);
    return;
  }

  const payload = new FormData();
  payload.append('map', JSON.stringify({
    name: nameColumn,
    type: document.getElementById('col-type').value.trim(),
    startTime: document.getElementById('col-start').value.trim(),
    endTime: document.getElementById('col-end').value.trim(),
    location: document.getElementById('col-location').value.trim(),
  }));
  payload.append('file', file, file.name);

  setMessage('Importing…');
  const response = await fetch(`${apiBase()}/api/plans/${planId}/import`, {
    method: 'POST',
    headers: authHeaders(),
    body: payload,
  });
  const body = await readJson(response);
  if (response.status === 401) {
    endSession();
    setMessage('Log in again.', true);
    return;
  }
  if (response.status === 403) {
    setMessage('Not allowed.', true);
    return;
  }
  if (response.status !== 201) {
    setMessage(body.message || 'Could not import the CSV.', true);
    return;
  }
  fileInput.value = '';
  setMessage(`Created ${body.name}. Inserted ${body.inserted}, skipped ${body.skipped}.`);
  await loadPlans();
});

if (sessionStorage.getItem(TOKEN_KEY)) {
  loadPlans().catch(() => setMessage('Could not load plans.', true));
} else {
  showSession(false);
}
