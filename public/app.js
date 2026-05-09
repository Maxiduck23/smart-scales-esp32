// CHYTRÁ VÁHA — app.js (clean rewrite)

// ── Auth ──────────────────────────────────────────────
function getToken() { return localStorage.getItem('cv_token'); }
function saveToken(t) { localStorage.setItem('cv_token', t); }
function getUser() { try { return JSON.parse(localStorage.getItem('cv_user') || 'null'); } catch (e) { return null; } }
function saveUser(u) { localStorage.setItem('cv_user', JSON.stringify(u)); }

function logout() {
  localStorage.removeItem('cv_token');
  localStorage.removeItem('cv_user');
  cacheClearAll();
  clearWeightInterval();
  router();
}
// ── Local cache / cookie-like storage ─────────────────
var CACHE_PREFIX = 'cv_cache_';
var LOG_KEY = 'cv_status_logs';

function cacheSet(key, value, ttlMs) {
  var payload = {
    value: value,
    expiresAt: Date.now() + ttlMs
  };

  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(payload));
  } catch (e) {
    console.warn('Cache write failed:', e);
  }
}

function cacheGet(key) {
  try {
    var raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;

    var payload = JSON.parse(raw);
    if (!payload || Date.now() > payload.expiresAt) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }

    return payload.value;
  } catch (e) {
    console.warn('Cache read failed:', e);
    return null;
  }
}

function cacheRemove(key) {
  localStorage.removeItem(CACHE_PREFIX + key);
}

function cacheClearAll() {
  Object.keys(localStorage).forEach(function (k) {
    if (k.startsWith(CACHE_PREFIX)) {
      localStorage.removeItem(k);
    }
  });
}

// ── Status logs ───────────────────────────────────────
function addStatusLog(type, message, extra) {
  var logs = [];

  try {
    logs = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
  } catch (e) {
    logs = [];
  }

  logs.unshift({
    type: type || 'info',
    message: message,
    extra: extra || null,
    time: new Date().toISOString()
  });

  logs = logs.slice(0, 50);
  localStorage.setItem(LOG_KEY, JSON.stringify(logs));

  var box = document.getElementById('status-log-list');
  if (box) renderStatusLogs();
}

function getStatusLogs() {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function clearStatusLogs() {
  localStorage.removeItem(LOG_KEY);
  renderStatusLogs();
}

function formatLogTime(iso) {
  var d = new Date(iso);
  return d.toLocaleTimeString('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function renderStatusLogs() {
  var box = document.getElementById('status-log-list');
  if (!box) return;

  var logs = getStatusLogs();

  if (!logs.length) {
    box.innerHTML = '<div class="empty">Zatím žádné logy</div>';
    return;
  }

  var html = '';

  logs.slice(0, 8).forEach(function (log) {
    var icon = log.type === 'error' ? '❌' : log.type === 'success' ? '✅' : log.type === 'weight' ? '<img src="/logo.svg" class="status-logo-img" alt="Chytrá váha">' : 'ℹ️';

    html += '<div class="status-log-item">'
      + '<span class="status-log-icon">' + icon + '</span>'
      + '<div class="status-log-main">'
      + '<div class="status-log-msg">' + escapeHtml(log.message) + '</div>'
      + '<div class="status-log-time">' + formatLogTime(log.time) + '</div>'
      + '</div>'
      + '</div>';
  });

  box.innerHTML = html;
}

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ── API ───────────────────────────────────────────────
async function api(path, options) {
  options = options || {};

  try {
    var res = await fetch('/api/' + path, Object.assign({}, options, {
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getToken()
      }, options.headers || {})
    }));

    if (res.status === 401) {
      addStatusLog('error', 'Relace vypršela, přihlaste se znovu');
      logout();
      return null;
    }

    var data = await res.json().catch(function () {
      return null;
    });

    if (!res.ok) {
      addStatusLog('error', 'API chyba: ' + path, data && data.error ? data.error : null);
      return data || null;
    }

    return data;
  } catch (e) {
    console.error('API error:', e);
    addStatusLog('error', 'Chyba připojení k API: ' + path);
    return null;
  }
}

// ── State ─────────────────────────────────────────────
var lastLoggedWeight = null;
var lastWeightLogAt = 0;
var currentPage = 'dashboard';
var weightIntervalId = null;
var searchTimer = null;
var cachedProfile = null;
var cachedMacroGoals = { calories: 2000, protein: 150, carbs: 250, fat: 65 };
var favoritesCache = {};
var mealsCache = {};
var productsCache = {};
var darkMode = localStorage.getItem('cv_dark') === '1';

function clearWeightInterval() {
  if (weightIntervalId) { clearInterval(weightIntervalId); weightIntervalId = null; }
}

function applyTheme() {
  document.body.classList.toggle('dark', darkMode);
}

// ── Router ────────────────────────────────────────────
function router(page) {
  page = page || 'dashboard';
  clearWeightInterval();
  if (!getToken()) { renderLogin(); return; }
  currentPage = page;
  if (page === 'dashboard') renderDashboard();
  else if (page === 'stats') renderStats();
  else if (page === 'profile') renderProfile();
  else renderDashboard();
}

// ── Toast ─────────────────────────────────────────────
function showToast(msg, undoFn, duration) {
  duration = duration || 4000;
  var container = document.getElementById('toast-container');
  if (!container) return;
  var toast = document.createElement('div');
  toast.className = 'toast';
  var span = document.createElement('span');
  span.textContent = msg;
  toast.appendChild(span);
  if (undoFn) {
    var btn = document.createElement('button');
    btn.className = 'toast-undo';
    btn.textContent = 'Zpět';
    btn.onclick = function () { undoFn(); toast.remove(); };
    toast.appendChild(btn);
  }
  container.appendChild(toast);
  setTimeout(function () { if (toast.parentNode) toast.remove(); }, duration);
}

// ── Nav ───────────────────────────────────────────────
function renderNav(active) {
  var items = [
    { id: 'dashboard', icon: '🏠', label: 'Přehled' },
    { id: 'stats', icon: '📅', label: 'Statistiky' },
    { id: 'profile', icon: '👤', label: 'Profil' }
  ];
  var html = '<nav class="bottom-nav">';
  items.forEach(function (item) {
    html += '<button class="nav-item' + (active === item.id ? ' active' : '') + '" onclick="router(\'' + item.id + '\')">'
      + '<span class="nav-icon">' + item.icon + '</span>'
      + '<span>' + item.label + '</span>'
      + '</button>';
  });
  html += '</nav>';
  return html;
}

function renderTopbar(title) {
  title = title || 'Chytrá váha';
  return '<div class="topbar">'
    + '<div class="topbar-logo"><img src="/logo.svg" class="topbar-logo-img" alt="Chytrá váha">' + title + '</div>'
    + '<div class="topbar-actions">'
    + '<button class="btn btn-icon" onclick="toggleDark()" title="Tmavý režim">' + (darkMode ? '☀️' : '🌙') + '</button>'
    + '<button class="btn btn-ghost btn-sm" onclick="logout()">Odhlásit</button>'
    + '</div></div>';
}

function toggleDark() {
  darkMode = !darkMode;
  localStorage.setItem('cv_dark', darkMode ? '1' : '0');
  applyTheme();
  // Re-render topbar icon only
  var topbar = document.querySelector('.topbar');
  if (topbar) topbar.outerHTML = renderTopbar(currentPage === 'dashboard' ? 'Chytrá váha' : currentPage === 'stats' ? 'Statistiky' : 'Profil');
}

// ═══════════════════════════════════════════════════════
//  LOGIN
// ═══════════════════════════════════════════════════════
function renderLogin() {
  document.getElementById('app').innerHTML =
    '<div class="auth-wrap">'
    + '<div class="auth-logo"><img src="/logo.svg" class="auth-logo-img" alt="Chytrá váha"></div>'
    + '<div class="auth-title">Chytrá váha</div>'
    + '<div class="auth-sub">Přihlaste se ke svému účtu</div>'
    + '<div class="auth-card">'
    + '<div class="err-msg" id="err"></div>'
    + '<div class="field"><label>Email</label>'
    + '<input type="email" id="login-email" placeholder="vas@email.cz" autocomplete="email"/></div>'
    + '<div class="field"><label>Heslo</label>'
    + '<input type="password" id="login-pass" placeholder="••••••••" autocomplete="current-password"/></div>'
    + '<button class="btn btn-primary" onclick="doLogin()">Přihlásit se</button>'
    + '<div class="auth-link">Nemáte účet? <a onclick="renderRegisterPage()">Registrovat se</a></div>'
    + '</div></div>';

  document.getElementById('login-pass').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doLogin();
  });
}

async function doLogin() {
  var email = document.getElementById('login-email').value.trim();
  var pass = document.getElementById('login-pass').value;
  var err = document.getElementById('err');
  err.style.display = 'none';
  if (!email || !pass) { err.textContent = 'Vyplňte email a heslo'; err.style.display = 'block'; return; }
  showToast('Přihlašuji...');
  addStatusLog('info', 'Přihlašuji...');
  console.log(data);
  var data = await api('auth/login', { method: 'POST', body: JSON.stringify({ email: email, password: pass }) });
  if (data && data.token) {
    console.log(data);
    saveToken(data.token);
    saveUser({ name: data.name, email: email });
    router();
    showToast('Přihlášení úspěšné');
    addStatusLog('success', 'Přihlášení úspěšné');
  } else {
    console.log(data);
    err.textContent = (data && data.error) ? data.error : 'Chyba přihlášení';
    err.style.display = 'block';
    showToast('Chybné údaje');
    addStatusLog('error', 'Chybné údaje');

  }
}

// ═══════════════════════════════════════════════════════
//  REGISTER (2 steps)
// ═══════════════════════════════════════════════════════
var regData = {};

function renderRegisterPage(step) {
  step = step || 1;
  var html = '<div class="auth-wrap">'
    + '<div class="auth-logo"><img src="/logo.svg" class="auth-logo-img" alt="Chytrá váha"></div>'
    + '<div class="auth-title">Registrace</div>'
    + '<div class="auth-sub">Krok ' + step + ' ze 2</div>'
    + '<div class="step-indicator">'
    + '<div class="step-dot ' + (step === 1 ? 'active' : 'done') + '"></div>'
    + '<div class="step-dot ' + (step === 2 ? 'active' : '') + '"></div>'
    + '</div>'
    + '<div class="auth-card"><div class="err-msg" id="err"></div>'
    + (step === 1 ? renderRegStep1() : renderRegStep2())
    + '</div>'
    + '<div class="auth-link">Máte účet? <a onclick="renderLogin()">Přihlásit se</a></div>'
    + '</div>';
  document.getElementById('app').innerHTML = html;
  if (step === 2) initGoalTabs();
}

function renderRegStep1() {
  return '<div class="field"><label>Jméno</label>'
    + '<input type="text" id="reg-name" placeholder="Vaše jméno" value="' + (regData.name || '') + '"/></div>'
    + '<div class="field"><label>Email</label>'
    + '<input type="email" id="reg-email" placeholder="vas@email.cz" value="' + (regData.email || '') + '"/></div>'
    + '<div class="field"><label>Heslo</label>'
    + '<input type="password" id="reg-pass" placeholder="min. 6 znaků"/></div>'
    + '<button class="btn btn-primary" onclick="regStep1Next()">Pokračovat →</button>';
}

function renderRegStep2() {
  var goals = ['lose', 'muscle', 'fit'];
  var goalLabels = { lose: 'Zhubnout', muscle: 'Nabrat svaly', fit: 'Být fit' };
  var tabsHtml = '<div class="goal-tabs" id="goal-tabs">';
  goals.forEach(function (g) {
    tabsHtml += '<button data-val="' + g + '" class="' + ((regData.goal || 'lose') === g ? 'active' : '') + '">' + goalLabels[g] + '</button>';
  });
  tabsHtml += '</div>';

  return '<div class="field"><label>Cíl</label>' + tabsHtml + '</div>'
    + '<div class="row-2">'
    + '<div class="field"><label>Rok narození</label><input type="number" id="reg-year" placeholder="2000" value="' + (regData.birth_year || '') + '" min="1950" max="2010"/></div>'
    + '<div class="field"><label>Výška (cm)</label><input type="number" id="reg-height" placeholder="170" value="' + (regData.height_cm || '') + '"/></div>'
    + '</div>'
    + '<div class="row-2">'
    + '<div class="field"><label>Hmotnost (kg)</label><input type="number" id="reg-weight" placeholder="70" value="' + (regData.weight_kg || '') + '"/></div>'
    + '<div class="field"><label>Cíl. hmotnost</label><input type="number" id="reg-gweight" placeholder="65" value="' + (regData.goal_weight_kg || '') + '"/></div>'
    + '</div>'
    + '<div class="field"><label>Aktivita</label><select id="reg-activity">'
    + '<option value="sedentary">Sedavý</option>'
    + '<option value="light" selected>Lehce aktivní</option>'
    + '<option value="moderate">Středně aktivní</option>'
    + '<option value="active">Velmi aktivní</option>'
    + '</select></div>'
    + '<div style="display:flex;gap:10px">'
    + '<button class="btn btn-ghost" style="flex:1" onclick="renderRegisterPage(1)">← Zpět</button>'
    + '<button class="btn btn-primary" style="flex:2" onclick="doRegister()">Vytvořit účet</button>'
    + '</div>';
}

function initGoalTabs() {
  regData.goal = regData.goal || 'lose';
  document.querySelectorAll('#goal-tabs button').forEach(function (btn) {
    btn.onclick = function () {
      regData.goal = btn.getAttribute('data-val');
      document.querySelectorAll('#goal-tabs button').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
    };
  });
}

function regStep1Next() {
  var name = document.getElementById('reg-name').value.trim();
  var email = document.getElementById('reg-email').value.trim();
  var pass = document.getElementById('reg-pass').value;
  var err = document.getElementById('err');
  if (!name || !email || !pass) { err.textContent = 'Vyplňte všechna pole'; err.style.display = 'block'; return; }
  if (pass.length < 6) { err.textContent = 'Heslo musí mít alespoň 6 znaků'; err.style.display = 'block'; return; }
  regData = Object.assign(regData, { name: name, email: email, password: pass });
  renderRegisterPage(2);
}

async function doRegister() {
  var payload = {
    name: regData.name,
    email: regData.email,
    password: regData.password,
    goal: regData.goal || 'lose',
    birth_year: parseInt(document.getElementById('reg-year').value) || null,
    height_cm: parseInt(document.getElementById('reg-height').value) || null,
    weight_kg: parseFloat(document.getElementById('reg-weight').value) || null,
    goal_weight_kg: parseFloat(document.getElementById('reg-gweight').value) || null,
    activity: document.getElementById('reg-activity').value
  };
  var err = document.getElementById('err');
  var data = await api('auth/register', { method: 'POST', body: JSON.stringify(payload) });
  if (data && data.token) {
    saveToken(data.token);
    saveUser({ name: data.name, email: payload.email });
    regData = {};
    router();
    showToast('Registrace úspěšná');
    console.log(data);
    addStatusLog('success', 'Registrace úspěšná');
  } else {
    err.textContent = (data && data.error) ? data.error : 'Chyba registrace';
    err.style.display = 'block';
    showToast('Chyba registrace');
    console.log(data);
    addStatusLog('error', 'Chyba registrace');
  }
}

// ═══════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════
async function renderDashboard() {
  var app = document.getElementById('app');
  app.innerHTML = renderTopbar('Chytrá váha')
    + '<div class="page" id="dash-page">'
    // Weight hero
    + '<div class="weight-hero">'
    + '<div class="weight-hero-label">Aktuální váha ze senzoru</div>'
    + '<div class="weight-hero-value" id="w-val">--<span>g</span></div>'
    + '<div class="weight-hero-status"><div class="status-dot" id="w-dot"></div><span id="w-status">Čekám na váhu...</span></div>'
    + '</div>'
    // Macro grid
    + '<div class="macro-grid">'
    + macroBox('kcal', '--', 'kcal', 'Energie', 'mb-kcal')
    + macroBox('protein', '--', 'g', 'Bílkoviny', 'mb-protein')
    + macroBox('carbs', '--', 'g', 'Sacharidy', 'mb-carbs')
    + macroBox('fat', '--', 'g', 'Tuky', 'mb-fat')
    + '</div>'
    // Goals bars
    + '<div class="section-card">'
    + '<div class="section-title">Denní cíle</div>'
    + barRowHtml('Kalorie', 'bar-cal', '#f57c00')
    + barRowHtml('Bílkoviny', 'bar-pro', '#1565c0')
    + barRowHtml('Sacharidy', 'bar-carb', '#43a047')
    + barRowHtml('Tuky', 'bar-fat', '#6a1b9a')
    + '</div>'
    // Search
    + '<div class="section-card">'
    + '<div class="section-title">🔍 Přidat jídlo</div>'
    + '<div class="search-wrap">'
    + '<input type="text" id="search-input" placeholder="Hledat nebo zadat čárový kód..."/>'
    + '<button class="btn btn-primary btn-sm" onclick="searchFood()">🔍</button>'
    + '<button class="scan-btn" onclick="openScanner()" title="Skenovat čárový kód">📷</button>'
    + '<button class="manual-open-btn" onclick="openManualProduct()" title="Přidat vlastní produkt">➕</button>'
    + '</div>'
    + '<div id="search-results"></div>'
    + '</div>'
    // Meals
    + '<div class="section-card">'
    + '<div class="section-title"><span>Dnes jsem jedl</span><span id="total-kcal-badge" style="font-size:12px;color:var(--text-3);font-weight:400"></span></div>'
    + '<div id="meals-list"><div class="spinner"></div></div>'
    + '</div>'
    + '</div>'
    // Favorites
    + '<div class="section-card">'
    + '<div class="section-title">⭐ Oblíbená jídla</div>'
    + '<div id="favorite-products"></div>'
    + '</div>'
    // Stats panel
    + '<div class="section-card">'
    + '<div class="section-title">📊 Souhrn</div>'
    + '<div class="stats-grid">'
    + '<div class="stat-row"><span>Týdenní průměr</span><span id="stats-week-avg">-- kcal</span></div>'
    + '<div class="stat-row"><span>Nejvíc za den</span><span id="stats-max">-- kcal</span></div>'
    + '<div class="stat-row"><span>Dní v tomto týdnu</span><span id="stats-days">0</span></div>'
    + '</div>'
    + '</div>'
    // Water
    + '<div class="section-card">'
    + '<div class="section-title">💧 Voda</div>'
    + '<div class="water-grid">'
    + '<div class="water-cell" onclick="addWater(250)">250 ml</div>'
    + '<div class="water-cell" onclick="addWater(500)">500 ml</div>'
    + '<div class="water-cell" onclick="addWater(750)">750 ml</div>'
    + '<div class="water-cell" onclick="addWater(1000)">1000 ml</div>'
    + '<div class="water-cell" onclick="setWater(0)">Reset</div>'
    + '</div>'
    + '<div class="water-progress" style="margin-top:12px">'
    + '<div class="water-label" id="water-label">0 ml / 2500 ml</div>'
    + '<div class="water-bar" id="water-bar"><div class="water-fill" id="water-fill"></div></div>'
    + '</div>'
    + '</div>'
    // Activity
    + '<div class="section-card">'
    + '<div class="section-title">🏃 Cvičení</div>'
    + '<div id="activity-list"><div class="spinner"></div></div>'
    + '<div class="activity-summary" style="margin-top:12px">'
    + '<div class="activity-row"><span class="label">Celkem dnes</span><span id="activity-today" class="value">0 kcal</span></div>'
    + '<div class="activity-row"><span class="label">Nejvíc za den</span><span id="activity-max" class="value">0 kcal</span></div>'
    + '</div>'
    + '</div>'
    // Steps
    + '<div class="section-card">'
    + '<div class="section-title">👣 Kroky</div>'
    + '<div class="steps-summary" style="text-align:center;margin-bottom:12px">'
    + '<div style="font-size:32px;font-weight:700;color:var(--primary)" id="steps-count">--</div>'
    + '<div style="color:var(--text-3)">kroků / <span id="steps-goal">--</span></div>'
    + '</div>'
    + '<div class="steps-bar-wrap" style="margin-bottom:12px">'
    + '<div class="steps-bar" id="steps-bar"></div>'
    + '</div>'
    + '<div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap">'
    + '<button class="btn btn-secondary btn-sm" onclick="setSteps(0)">Reset</button>'
    + '<button class="btn btn-primary btn-sm" onclick="syncSteps()">Synchronizovat kroky</button>'
    + '</div>'
    + '</div>'
    // Weight history
    + '<div class="section-card">'
    + '<div class="section-title"><span class="section-title-main"><img src="/logo.svg" class="section-logo-img" alt="Chytrá váha">Váha v čase</span></div>'
    + '<div id="weight-chart" style="height:200px;margin-bottom:12px"></div>'
    + '<div class="chart-legend">'
    + '<div class="legend-item"><div class="legend-dot" style="background:#ff6f00"></div>Dnes</div>'
    + '<div class="legend-item"><div class="legend-dot" style="background:#7c4dff"></div>Tento týden</div>'
    + '<div class="legend-item"><div class="legend-dot" style="background:#263238"></div>Cíl</div>'
    + '</div>'
    + '</div>'
    // Recipes
    + '<div class="section-card">'
    + '<div class="section-title">👨‍🍳 Recepty</div>'
    + '<div class="recipe-grid">'
    + '<div class="recipe-card" onclick="openRecipeSearch()">'
    + '<div class="recipe-icon">🔍</div>'
    + '<div class="recipe-label">Hledat recepty</div>'
    + '</div>'
    + '<div class="recipe-card" onclick="openMyRecipes()">'
    + '<div class="recipe-icon">📕</div>'
    + '<div class="recipe-label">Mé recepty</div>'
    + '</div>'
    + '</div>'
    + '</div>'
    + '<div class="section-card">'
    + '<div class="section-title">🎯 Cíle a nastavení</div>'
    + '<div class="settings-grid">'
    + '<div class="setting-item">'
    + '<div class="setting-label">Denní příjem kalorií</div>'
    + '<div class="setting-value">'
    + '<input type="number" class="setting-input" id="goal-kcal" min="1000" max="10000" step="100" value="2500"/>'
    + '<span class="setting-unit">kcal</span>'
    + '</div>'
    + '<div class="setting-hint">Tvé celkové denní kalorie</div>'
    + '</div>'
    + '<div class="setting-item">'
    + '<div class="setting-label">Denní příjem bílkovin</div>'
    + '<div class="setting-value">'
    + '<input type="number" class="setting-input" id="goal-protein" min="10" max="500" step="5" value="80"/>'
    + '<span class="setting-unit">g</span>'
    + '</div>'
    + '<div class="setting-hint">Doporučený příjem bílkovin</div>'
    + '</div>'
    + '<div class="setting-item">'
    + '<div class="setting-label">Denní příjem sacharidů</div>'
    + '<div class="setting-value">'
    + '<input type="number" class="setting-input" id="goal-carbs" min="10" max="1000" step="10" value="250"/>'
    + '<span class="setting-unit">g</span>'
    + '</div>'
    + '<div class="setting-hint">Doporučený příjem sacharidů</div>'
    + '</div>'
    + '<div class="setting-item">'
    + '<div class="setting-label">Denní příjem tuků</div>'
    + '<div class="setting-value">'
    + '<input type="number" class="setting-input" id="goal-fat" min="10" max="300" step="5" value="70"/>'
    + '<span class="setting-unit">g</span>'
    + '</div>'
    + '<div class="setting-hint">Doporučený příjem tuků</div>'
    + '</div>'
    + '<div class="setting-item">'
    + '<div class="setting-label">Cílová váha</div>'
    + '<div class="setting-value">'
    + '<input type="number" class="setting-input" id="target-weight" min="30" max="300" step="0.5" value="70"/>'
    + '<span class="setting-unit">kg</span>'
    + '</div>'
    + '<div class="setting-hint">Tvoje cílová váha</div>'
    + '</div>'
    + '<div class="setting-item">'
    + '<div class="setting-label">Denní cílový příjem kalorií</div>'
    + '<div class="setting-value">'
    + '<input type="number" class="setting-input" id="goal-daily-kcal" min="1000" max="10000" step="10" value="2000"/>'
    + '<span class="setting-unit">kcal</span>'
    + '</div>'
    + '<div class="setting-hint">Celkový denní příjem kalorií</div>'
    + '</div>'
    + '</div>'
    + '<div style="margin-top:16px;text-align:center">'
    + '<button class="btn btn-primary" onclick="saveAllGoals()">Uložit změny</button>'
    + '</div>'
    + '</div>'
    + renderNav('dashboard');

  // Search input live
  var si = document.getElementById('search-input');
  if (si) {
    si.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(searchFood, 480);
    });
    si.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') searchFood();
    });
  }

  startWeightPolling();
  await loadMealsAndProfile();
  renderStatusLogs();
  addStatusLog('info', 'Dashboard načten');
  console.log(data);
  if (
    lastLoggedWeight !== data.grams &&
    Date.now() - lastWeightLogAt > 5000
  ) {
    lastLoggedWeight = data.grams;
    lastWeightLogAt = Date.now();
    addStatusLog('weight', 'Přijata váha: ' + data.grams + ' g');
  }
}

function macroBox(cls, val, unit, lbl, id) {
  return '<div class="macro-box ' + cls + '">'
    + '<div class="macro-val" id="' + id + '">' + val + '<small>' + unit + '</small></div>'
    + '<div class="macro-lbl">' + lbl + '</div>'
    + '</div>';
}

function barRowHtml(name, id, color) {
  return '<div class="bar-row">'
    + '<div class="bar-head"><span class="bar-name">' + name + '</span><span class="bar-nums" id="v-' + id + '">--</span></div>'
    + '<div class="bar-track"><div class="bar-fill" id="' + id + '" style="width:0%;background:' + color + '"></div></div>'
    + '</div>';
}

// Alias used by stats page too
function barRow(name, id, color) { return barRowHtml(name, id, color); }

// ── Weight polling ────────────────────────────────────
function startWeightPolling() {
  clearWeightInterval();
  weightIntervalId = setInterval(async function () {
    if (!document.getElementById('w-val')) { clearWeightInterval(); return; }
    var data = await api('weight');
    if (data && data.grams != null) {
      document.getElementById('w-val').innerHTML = data.grams + '<span>g</span>';
      var dot = document.getElementById('w-dot');
      var st = document.getElementById('w-status');
      if (dot) dot.classList.add('active');
      if (st) st.textContent = '✓ Váha stabilizována';
    }
  }, 1000);
}

// ── Macros / goals ────────────────────────────────────
function calcMacroGoals(p) {
  if (!p || !p.birth_year || !p.weight_kg || !p.height_cm) return cachedMacroGoals;
  var age = new Date().getFullYear() - p.birth_year;
  var bmr = 10 * p.weight_kg + 6.25 * p.height_cm - 5 * age;
  var fMap = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 };
  var tdee = bmr * (fMap[p.activity] || 1.375);
  var aMap = { lose: -500, muscle: 300, fit: 0 };
  var cal = Math.round(tdee + (aMap[p.goal] || 0));
  var pMap = { lose: 1.6, muscle: 2.0, fit: 1.4 };
  var prot = Math.round(p.weight_kg * (pMap[p.goal] || 1.5));
  var fat = Math.round(cal * 0.27 / 9);
  var carbs = Math.round((cal - prot * 4 - fat * 9) / 4);
  return { calories: cal, protein: prot, fat: fat, carbs: carbs };
}

async function loadMealsAndProfile() {
  if (!cachedProfile) {
    cachedProfile = await api('profile');
    if (cachedProfile) cachedMacroGoals = calcMacroGoals(cachedProfile);
  }
  await loadMeals();
}

async function loadMeals() {
  var data = await api('meals');
  if (!data) return;
  var t = data.totals || {};
  var g = cachedMacroGoals;

  setEl('mb-kcal', Math.round(t.calories || 0) + '<small>kcal</small>');
  setEl('mb-protein', Math.round(t.protein || 0) + '<small>g</small>');
  setEl('mb-carbs', Math.round(t.carbs || 0) + '<small>g</small>');
  setEl('mb-fat', Math.round(t.fat || 0) + '<small>g</small>');

  setBar('bar-cal', t.calories || 0, g.calories, Math.round(t.calories || 0) + ' / ' + g.calories + ' kcal');
  setBar('bar-pro', t.protein || 0, g.protein, Math.round(t.protein || 0) + ' / ' + g.protein + ' g');
  setBar('bar-carb', t.carbs || 0, g.carbs, Math.round(t.carbs || 0) + ' / ' + g.carbs + ' g');
  setBar('bar-fat', t.fat || 0, g.fat, Math.round(t.fat || 0) + ' / ' + g.fat + ' g');

  var badge = document.getElementById('total-kcal-badge');
  if (badge) badge.textContent = Math.round(t.calories || 0) + ' kcal celkem';

  var list = document.getElementById('meals-list');
  if (!list) return;
  if (!data.meals || !data.meals.length) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">🍽️</div>Zatím nic přidáno</div>';
    return;
  }

  // Save to cache BEFORE rendering
  mealsCache = {};
  data.meals.forEach(function (m) { mealsCache[m.id] = m; });

  var html = '';
  data.meals.forEach(function (m) {
    var kcal = Math.round((m.products && m.products.calories ? m.products.calories : 0) * m.weight_g / 100);
    var name = m.products && m.products.name ? m.products.name : '?';
    html += '<div class="meal-item" id="meal-' + m.id + '">'
      + '<div class="meal-dot"></div>'
      + '<div class="meal-info">'
      + '<div class="meal-name">' + name + '</div>'
      + '<div class="meal-meta">' + m.weight_g + ' g · ' + kcal + ' kcal</div>'
      + '</div>'
      + '<span class="meal-kcal">' + kcal + ' kcal</span>'
      + '<button class="btn btn-danger btn-sm del-btn" data-mid="' + m.id + '">✕</button>'
      + '</div>';
  });
  list.innerHTML = html;

  // Attach delete handlers
  list.querySelectorAll('.del-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      deleteMeal(btn.getAttribute('data-mid'));
    });
  });
}

function setEl(id, html) {
  var el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function setBar(barId, val, goal, label) {
  var bar = document.getElementById(barId);
  var lbl = document.getElementById('v-' + barId);
  if (bar) bar.style.width = Math.min(val / goal * 100, 100) + '%';
  if (lbl) lbl.textContent = label;
}
// ═══════════════════════════════════════════════════════
//  FAVORITES
// ═══════════════════════════════════════════════════════
async function loadFavorites(force) {
  var cached = !force ? cacheGet('favorites') : null;

  if (cached) {
    applyFavoritesCache(cached);
    return cached;
  }

  var data = await api('favorites');

  if (!data || !data.favorites) {
    return [];
  }

  cacheSet('favorites', data.favorites, 5 * 60 * 1000);
  applyFavoritesCache(data.favorites);

  return data.favorites;
}

function applyFavoritesCache(favorites) {
  favoritesCache = {};

  (favorites || []).forEach(function (f) {
    favoritesCache[f.product_id] = f;
  });
}

function isFavoriteProduct(productId) {
  return !!favoritesCache[productId];
}

async function addFavorite(productId) {
  var data = await api('favorites', {
    method: 'POST',
    body: JSON.stringify({ product_id: parseInt(productId) })
  });

  if (data && data.ok) {
    cacheRemove('favorites');
    await loadFavorites(true);
    addStatusLog('success', 'Produkt přidán do oblíbených');
    showToast('⭐ Přidáno do oblíbených');
    renderFavoriteProducts();
  } else if (data && data.error === 'Already in favorites') {
    showToast('Už je v oblíbených');
  } else {
    showToast('❌ Nepodařilo se přidat do oblíbených');
  }
}

async function removeFavorite(productId) {
  var data = await api('favorites', {
    method: 'DELETE',
    body: JSON.stringify({ product_id: parseInt(productId) })
  });

  if (data && data.ok) {
    cacheRemove('favorites');
    await loadFavorites(true);
    addStatusLog('success', 'Produkt odebrán z oblíbených');
    showToast('Odebráno z oblíbených');
    renderFavoriteProducts();
  } else {
    showToast('❌ Nepodařilo se odebrat z oblíbených');
  }
}

async function toggleFavorite(productId) {
  if (isFavoriteProduct(productId)) {
    await removeFavorite(productId);
  } else {
    await addFavorite(productId);
  }

  var q = document.getElementById('search-input');
  if (q && q.value.trim()) {
    await searchFood();
  }
}

function renderFavoriteProducts() {
  var box = document.getElementById('favorite-products');
  if (!box) return;

  var favs = Object.values(favoritesCache || {});

  if (!favs.length) {
    box.innerHTML = '<div class="empty"><div class="empty-icon">⭐</div>Zatím žádná oblíbená jídla</div>';
    return;
  }

  var html = '';

  favs.forEach(function (f) {
    var p = f.products;
    if (!p) return;

    var kcal = p.calories != null ? p.calories : '?';

    html += '<div class="favorite-item">'
      + '<div class="favorite-info">'
      + '<div class="favorite-name">' + escapeHtml(p.name) + '</div>'
      + '<div class="favorite-meta">' + kcal + ' kcal/100g</div>'
      + '</div>'
      + '<div class="favorite-actions">'
      + '<input type="number" class="favorite-grams" data-pid="' + p.id + '" value="100" min="1"/>'
      + '<button class="btn btn-primary btn-sm" onclick="addFavoriteMeal(' + p.id + ')">Přidat</button>'
      + '<button class="btn btn-icon" onclick="removeFavorite(' + p.id + ')" title="Odebrat">✕</button>'
      + '</div>'
      + '</div>';
  });

  box.innerHTML = html;
}

async function addFavoriteMeal(productId) {
  var inp = document.querySelector('.favorite-grams[data-pid="' + productId + '"]');
  var grams = parseInt(inp ? inp.value : 100) || 100;

  var favorite = favoritesCache[productId];
  if (favorite && favorite.products) {
    productsCache[productId] = favorite.products;
  }

  await addMeal(productId, grams);
}


// ═══════════════════════════════════════════════════════
//  SEARCH + ADD MEAL
// ═══════════════════════════════════════════════════════
async function searchFood() {
  var q = (document.getElementById('search-input')
    ? document.getElementById('search-input').value
    : ''
  ).trim();

  if (!q) return;

  var results = document.getElementById('search-results');
  if (!results) return;

  results.innerHTML = '<div class="loading-text">Hledám...</div>';
  addStatusLog('info', 'Hledám jídlo');

  var data = await api('products?q=' + encodeURIComponent(q));

  if (!data || !data.length) {
    results.innerHTML = '<div class="loading-text">Nic nenalezeno</div>';
    addStatusLog('error', 'Jídlo nenalezeno');
    return;
  }

  addStatusLog('success', 'Nalezeno jídlo');

  productsCache = {};
  data.forEach(function (p) {
    productsCache[p.id] = p;
  });

  var html = '';

  data.forEach(function (p) {
    var imgHtml = p.image_url
      ? '<img class="product-img" src="' + p.image_url + '" alt="">'
      : '<div class="product-img-placeholder">🥫</div>';

    var macros = p.calories + ' kcal/100g'
      + ' · B' + (p.protein_g != null ? p.protein_g : '?') + 'g'
      + ' T' + (p.fat_g != null ? p.fat_g : '?') + 'g'
      + ' S' + (p.carbs_g != null ? p.carbs_g : '?') + 'g';

    html += '<div class="product-result">'
      + imgHtml
      + '<div class="product-info">'
      + '<div class="product-name">' + escapeHtml(p.name) + '</div>'
      + '<div class="product-kcal">' + macros + '</div>'
      + '</div>'
      + '<div class="product-add">'
      + '<button class="btn btn-icon fav-btn" data-pid="' + p.id + '" title="Oblíbené">'
      + (isFavoriteProduct(p.id) ? '⭐' : '☆')
      + '</button>'
      + '<input type="number" class="grams-input" data-pid="' + p.id + '" value="100" min="1" style="width:60px"/>'
      + '<button class="btn btn-primary btn-sm add-btn" data-pid="' + p.id + '">+</button>'
      + '</div>'
      + '</div>';
  });

  results.innerHTML = html;

  results.querySelectorAll('.add-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var pid = btn.getAttribute('data-pid');
      var inp = results.querySelector('.grams-input[data-pid="' + pid + '"]');
      var grams = parseInt(inp ? inp.value : 100) || 100;
      addMeal(pid, grams);
    });
  });

  results.querySelectorAll('.fav-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var pid = btn.getAttribute('data-pid');
      toggleFavorite(pid);
    });
  });
}
async function addMeal(pid, grams) {
  var p = productsCache[pid];
  var name = p ? p.name : 'produkt';
  await api('meals', {
    method: 'POST',
    body: JSON.stringify({ product_id: pid, weight_g: grams, meal_type: 'snack' })
  });
  showToast('✓ ' + name + ' přidáno');
  await loadMeals();
}

// ── Delete + Undo ─────────────────────────────────────
async function deleteMeal(id) {
  // Deep copy BEFORE anything clears the cache
  var saved = mealsCache[id] ? JSON.parse(JSON.stringify(mealsCache[id])) : null;
  var savedName = saved && saved.products ? saved.products.name : 'jídlo';
  // Visual feedback
  var el = document.getElementById('meal-' + id);
  if (el) el.style.opacity = '0.3';

  await api('meals', { method: 'DELETE', body: JSON.stringify({ meal_id: parseInt(id) }) });
  await loadMeals();
  addStatusLog('info', 'Jídlo smazáno: ' + savedName);
  showToast('Smazáno: ' + savedName, async function () {
    if (saved && saved.product_id && saved.weight_g) {
      await api('meals', {
        method: 'POST',
        body: JSON.stringify({
          product_id: saved.product_id,
          weight_g: saved.weight_g,
          meal_type: saved.meal_type || 'snack'
        })
      });
      await loadMeals();
      showToast('✓ Obnoveno');
    }
  });
}

// ═══════════════════════════════════════════════════════
//  STATS PAGE
// ═══════════════════════════════════════════════════════
var statsDays = 7;
var _origRenderStats = renderStats;
async function renderStats() {
  var app = document.getElementById('app');
  app.innerHTML = renderTopbar('Statistiky')
    + '<div class="page">'
    + '<div class="stats-toggle">'
    + '<button class="btn ' + (statsDays === 7 ? 'btn-primary' : 'btn-ghost') + '" onclick="loadStats(7)">7 dní</button>'
    + '<button class="btn ' + (statsDays === 30 ? 'btn-primary' : 'btn-ghost') + '" onclick="loadStats(30)">30 dní</button>'
    + '</div>'
    + '<div class="section-card"><div class="section-title">Kalorický přehled</div>'
    + '<div class="days-scroll" id="days-scroll"><div class="spinner"></div></div>'
    + '</div>'
    + '<div class="section-card" id="day-detail">'
    + '<div class="empty"><div class="empty-icon">👆</div>Klikni na den pro detail</div>'
    + '</div></div>'
    + renderNav('stats');
  await loadStats(statsDays);
  setTimeout(function () {
    enableDragScroll(document.getElementById('days-scroll'));
  }, 100);
}

var daysCache = {};
var _origLoadStatsP2 = loadStats;
async function loadStats(days) {
  var _origLoadStats = loadStats;
  loadStats = async function (days) {
    statsDays = days;
    document.querySelectorAll('.stats-toggle .btn').forEach(function (btn, i) {
      btn.className = 'btn ' + (statsDays === (i === 0 ? 7 : 30) ? 'btn-primary' : 'btn-ghost');
    });

    var data = await api('stats?days=' + days);
    var container = document.getElementById('days-scroll');
    if (!container) return;

    if (!data || !data.days || !Object.keys(data.days).length) {
      container.innerHTML = '<div class="loading-text">Žádná data</div>';
      return;
    }

    var goal = cachedMacroGoals.calories;
    var dayNames = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
    var localDaysCache = {};
    var allDays = [];

    for (var i = days - 1; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      var key = d.toISOString().split('T')[0];
      allDays.push({ key: key, d: new Date(d), dd: data.days[key] || null });
    }

    var html = '';
    allDays.forEach(function (item) {
      if (item.dd) localDaysCache[item.key] = item.dd;
      var kcal = item.dd ? Math.round(item.dd.calories) : 0;
      var pct = Math.min(kcal / goal, 1);
      var r = 22, circ = 2 * Math.PI * r, dash = pct * circ;
      var color = !item.dd ? '#ddd' : pct < 0.7 ? '#1565c0' : pct < 1.1 ? '#43a047' : '#d32f2f';
      var isToday = item.d.toDateString() === new Date().toDateString();
      var lbl = isToday ? 'Dnes' : dayNames[item.d.getDay()];
      html += '<div class="day-pill" data-key="' + item.key + '" style="cursor:pointer">'
        + '<div class="day-label">' + lbl + '</div>'
        + '<div class="day-circle-wrap">'
        + '<svg width="54" height="54" viewBox="0 0 54 54">'
        + '<circle cx="27" cy="27" r="' + r + '" fill="none" stroke="#eee" stroke-width="4"/>'
        + '<circle cx="27" cy="27" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="4"'
        + ' stroke-dasharray="' + dash + ' ' + circ + '" stroke-linecap="round"/>'
        + '</svg>'
        + '<div class="day-circle-inner">'
        + '<span class="day-kcal">' + (kcal || '—') + '</span>'
        + '<span class="day-kcal-lbl">kcal</span>'
        + '</div></div>'
        + '<div class="day-date">' + item.d.getDate() + '.' + (item.d.getMonth() + 1) + '</div>'
        + '</div>';
    });
    container.innerHTML = html;

    await _origLoadStatsP2(days);
    setTimeout(function () {
      enableDragScroll(document.getElementById('days-scroll'));
    }, 100);

    // Вешаем клики через addEventListener — не через onclick атрибут
    container.querySelectorAll('.day-pill').forEach(function (pill) {
      pill.addEventListener('click', function () {
        var key = pill.getAttribute('data-key');
        var dd = localDaysCache[key];
        var detail = document.getElementById('day-detail');
        if (!detail) return;
        if (!dd || !dd.calories) {
          detail.innerHTML = '<div class="empty"><div class="empty-icon">🍽️</div>Žádná data pro tento den</div>';
          return;
        }
        var g = cachedMacroGoals;
        var dObj = new Date(key);
        var fmt = dObj.getDate() + '. ' + (dObj.getMonth() + 1) + '. ' + dObj.getFullYear();
        detail.innerHTML = '<div class="section-title">' + fmt + '</div>'
          + barRow('Kalorie', 'dc-cal', '#f57c00')
          + barRow('Bílkoviny', 'dc-pro', '#1565c0')
          + barRow('Sacharidy', 'dc-carb', '#43a047')
          + barRow('Tuky', 'dc-fat', '#6a1b9a');
        setBar('dc-cal', dd.calories || 0, g.calories, Math.round(dd.calories) + ' / ' + g.calories + ' kcal', 'v-dc-cal');
        setBar('dc-pro', dd.protein || 0, g.protein, Math.round(dd.protein) + ' / ' + g.protein + ' g', 'v-dc-pro');
        setBar('dc-carb', dd.carbs || 0, g.carbs, Math.round(dd.carbs) + ' / ' + g.carbs + ' g', 'v-dc-carb');
        setBar('dc-fat', dd.fat || 0, g.fat, Math.round(dd.fat) + ' / ' + g.fat + ' g', 'v-dc-fat');
      });
    });
  };
}
function showDayDetail(key) {
  var dd = daysCache[key];
  var detail = document.getElementById('day-detail');
  if (!detail) return;
  if (!dd || !dd.calories) {
    detail.innerHTML = '<div class="empty"><div class="empty-icon">🍽️</div>Žádná data pro tento den</div>';
    return;
  }
  var g = cachedMacroGoals;
  var d = new Date(key);
  var fmt = d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear();
  detail.innerHTML = '<div class="section-title">' + fmt + '</div>'
    + barRowHtml('Kalorie', 'dc-cal', '#f57c00')
    + barRowHtml('Bílkoviny', 'dc-pro', '#1565c0')
    + barRowHtml('Sacharidy', 'dc-carb', '#43a047')
    + barRowHtml('Tuky', 'dc-fat', '#6a1b9a');
  setBar('dc-cal', dd.calories || 0, g.calories, Math.round(dd.calories) + ' / ' + g.calories + ' kcal');
  setBar('dc-pro', dd.protein || 0, g.protein, Math.round(dd.protein) + ' / ' + g.protein + ' g');
  setBar('dc-carb', dd.carbs || 0, g.carbs, Math.round(dd.carbs) + ' / ' + g.carbs + ' g');
  setBar('dc-fat', dd.fat || 0, g.fat, Math.round(dd.fat) + ' / ' + g.fat + ' g');
}

// ═══════════════════════════════════════════════════════
//  PROFILE PAGE
// ═══════════════════════════════════════════════════════
var profileGoal = 'fit';

async function renderProfile() {
  var app = document.getElementById('app');
  app.innerHTML = renderTopbar('Profil')
    + '<div class="page"><div class="section-card" id="profile-content"><div class="spinner"></div></div></div>'
    + renderNav('profile');

  var p = await api('profile');
  cachedProfile = p;
  var user = getUser();
  var goals = p ? calcMacroGoals(p) : cachedMacroGoals;
  profileGoal = (p && p.goal) ? p.goal : 'fit';

  var initials = user && user.name ? user.name[0].toUpperCase() : '?';
  var goalLabels = { lose: 'Zhubnout', muscle: 'Nabrat svaly', fit: 'Být fit' };
  var actLabels = { sedentary: 'Sedavý', light: 'Lehce aktivní', moderate: 'Středně aktivní', active: 'Velmi aktivní' };
  var act = (p && p.activity) ? p.activity : 'light';

  var goalTabsHtml = '<div class="goal-tabs" id="p-goal-tabs">';
  ['lose', 'muscle', 'fit'].forEach(function (g) {
    goalTabsHtml += '<button data-val="' + g + '" class="' + (profileGoal === g ? 'active' : '') + '">' + goalLabels[g] + '</button>';
  });
  goalTabsHtml += '</div>';

  var actOptions = ['sedentary', 'light', 'moderate', 'active'].map(function (v) {
    return '<option value="' + v + '"' + (act === v ? ' selected' : '') + '>' + actLabels[v] + '</option>';
  }).join('');

  document.getElementById('profile-content').innerHTML =
    '<div class="profile-header">'
    + '<div class="profile-avatar">' + initials + '</div>'
    + '<div><div class="profile-name">' + (user ? user.name : '') + '</div>'
    + '<div class="profile-email">' + (user ? user.email : '') + '</div></div>'
    + '</div>'
    // TDEE box
    + '<div class="tdee-box">'
    + '<div><div class="tdee-label">Doporučený denní příjem</div>'
    + '<div class="tdee-value">' + goals.calories + ' kcal</div>'
    + '<div class="tdee-sub">' + goalLabels[profileGoal] + ' · ' + actLabels[act] + '</div></div>'
    + '<div style="font-size:40px">🎯</div>'
    + '</div>'
    // Macro grid
    + '<div class="macro-grid" style="margin-bottom:20px">'
    + macroBox('protein', goals.protein, 'g', 'Bílkoviny', 'pm-protein')
    + macroBox('carbs', goals.carbs, 'g', 'Sacharidy', 'pm-carbs')
    + macroBox('fat', goals.fat, 'g', 'Tuky', 'pm-fat')
    + macroBox('kcal', goals.calories, 'kcal', 'Energie', 'pm-kcal')
    + '</div>'
    + '<div class="divider"></div>'
    + '<div class="section-title" style="margin-bottom:16px">Upravit profil</div>'
    + '<div class="field"><label>Cíl</label>' + goalTabsHtml + '</div>'
    // Sliders
    + '<div class="profile-slider-wrap">'
    + '<div class="profile-slider-head"><span>Hmotnost</span><span id="lbl-weight">' + ((p && p.weight_kg) ? p.weight_kg : 70) + ' kg</span></div>'
    + '<input type="range" id="sl-weight" min="40" max="200" value="' + ((p && p.weight_kg) ? p.weight_kg : 70) + '"/>'
    + '</div>'
    + '<div class="profile-slider-wrap">'
    + '<div class="profile-slider-head"><span>Výška</span><span id="lbl-height">' + ((p && p.height_cm) ? p.height_cm : 170) + ' cm</span></div>'
    + '<input type="range" id="sl-height" min="140" max="220" value="' + ((p && p.height_cm) ? p.height_cm : 170) + '"/>'
    + '</div>'
    + '<div class="profile-slider-wrap">'
    + '<div class="profile-slider-head"><span>Cílová hmotnost</span><span id="lbl-gw">' + ((p && p.goal_weight_kg) ? p.goal_weight_kg : 65) + ' kg</span></div>'
    + '<input type="range" id="sl-gw" min="40" max="200" value="' + ((p && p.goal_weight_kg) ? p.goal_weight_kg : 65) + '"/>'
    + '</div>'
    + '<div class="field" style="margin-top:8px"><label>Aktivita</label><select id="p-activity">' + actOptions + '</select></div>'
    + '<button class="btn btn-primary" style="margin-top:8px" onclick="saveProfile()">Uložit změny</button>';

  // Sliders live update
  document.getElementById('sl-weight').addEventListener('input', function () {
    document.getElementById('lbl-weight').textContent = this.value + ' kg';
  });
  document.getElementById('sl-height').addEventListener('input', function () {
    document.getElementById('lbl-height').textContent = this.value + ' cm';
  });
  document.getElementById('sl-gw').addEventListener('input', function () {
    document.getElementById('lbl-gw').textContent = this.value + ' kg';
  });

  // Goal tabs
  document.querySelectorAll('#p-goal-tabs button').forEach(function (btn) {
    btn.onclick = function () {
      profileGoal = btn.getAttribute('data-val');
      document.querySelectorAll('#p-goal-tabs button').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
    };
  });
}

async function saveProfile() {
  var payload = {
    weight_kg: parseFloat(document.getElementById('sl-weight').value),
    height_cm: parseInt(document.getElementById('sl-height').value),
    goal_weight_kg: parseFloat(document.getElementById('sl-gw').value),
    activity: document.getElementById('p-activity').value,
    goal: profileGoal
  };
  var data = await api('profile', { method: 'PATCH', body: JSON.stringify(payload) });
  if (data) {
    cachedProfile = data;
    cachedMacroGoals = calcMacroGoals(data);
    showToast('✓ Profil uložen');
    renderProfile();
  } else {
    showToast('❌ Chyba ukládání');
  }
}

// ═══════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════
applyTheme();
function enableDragScroll(el) {
  if (!el) return;
  var isDown = false, startX, scrollLeft;
  el.addEventListener('mousedown', function (e) {
    isDown = true;
    el.style.cursor = 'grabbing';
    startX = e.pageX - el.offsetLeft;
    scrollLeft = el.scrollLeft;
  });
  el.addEventListener('mouseleave', function () { isDown = false; el.style.cursor = 'grab'; });
  el.addEventListener('mouseup', function () { isDown = false; el.style.cursor = 'grab'; });
  el.addEventListener('mousemove', function (e) {
    if (!isDown) return;
    e.preventDefault();
    var x = e.pageX - el.offsetLeft;
    el.scrollLeft = scrollLeft - (x - startX);
  });
  el.style.cursor = 'grab';
  // Скролл колёсиком горизонтально
  el.addEventListener('wheel', function (e) {
    if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) {
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    }
  }, { passive: false });
}
var _origDeleteMealP2 = deleteMeal;
deleteMeal = async function (id) {
  var saved = mealsCache[id] ? JSON.parse(JSON.stringify(mealsCache[id])) : null;
  var savedName = saved && saved.products ? saved.products.name : 'jídlo';

  // Анимация исчезания
  var el = document.getElementById('meal-' + id);
  if (el) {
    el.style.transition = 'all 0.3s ease';
    el.style.opacity = '0';
    el.style.maxHeight = el.offsetHeight + 'px';
    setTimeout(function () {
      el.style.maxHeight = '0';
      el.style.padding = '0';
      el.style.margin = '0';
      el.style.overflow = 'hidden';
    }, 150);
  }

  await new Promise(function (r) { setTimeout(r, 300); }); // ждём анимацию
  await api('meals', { method: 'DELETE', body: JSON.stringify({ meal_id: id }) });
  await loadMeals();

  showToast('Smazáno: ' + savedName, async function () {
    if (saved && saved.product_id && saved.weight_g) {
      await api('meals', {
        method: 'POST',
        body: JSON.stringify({
          product_id: saved.product_id,
          weight_g: saved.weight_g,
          meal_type: saved.meal_type || 'snack'
        })
      });
      await loadMeals();
      showToast('✓ Obnoveno');
    }
  });
};

// ── 3. ТЁМНАЯ ТЕМА НА ЛОГИН / РЕГИСТРАЦИИ ────────────
// Патчим renderLogin
var _origRenderLogin = renderLogin;
renderLogin = function () {
  _origRenderLogin();
  // Добавляем кнопку тёмной темы на страницу логина
  var app = document.getElementById('app');
  var btn = document.createElement('button');
  btn.className = 'dark-float-btn';
  btn.textContent = darkMode ? '☀️' : '🌙';
  btn.onclick = function () {
    darkMode = !darkMode;
    localStorage.setItem('cv_dark', darkMode ? '1' : '0');
    applyTheme();
    btn.textContent = darkMode ? '☀️' : '🌙';
  };
  app.appendChild(btn);
};

// Патчим renderRegisterPage тоже
var _origRenderRegPage = renderRegisterPage;
renderRegisterPage = function (step) {
  _origRenderRegPage(step);
  var app = document.getElementById('app');
  var btn = document.createElement('button');
  btn.className = 'dark-float-btn';
  btn.textContent = darkMode ? '☀️' : '🌙';
  btn.onclick = function () {
    darkMode = !darkMode;
    localStorage.setItem('cv_dark', darkMode ? '1' : '0');
    applyTheme();
    btn.textContent = darkMode ? '☀️' : '🌙';
  };
  app.appendChild(btn);
};
(function injectScannerStyles() {
  var style = document.createElement('style');
  style.textContent = `
    /* ── Scanner modal overlay ── */
    #scanner-modal {
      position: fixed; inset: 0; z-index: 9000;
      background: rgba(0,0,0,0.85);
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      animation: fadeUp 0.2s ease;
    }
    #scanner-modal .scan-box {
      background: var(--card);
      border-radius: var(--radius);
      padding: 20px;
      width: calc(100% - 32px);
      max-width: 420px;
      box-shadow: var(--shadow-lg);
    }
    #scanner-modal .scan-title {
      font-size: 16px; font-weight: 700; color: var(--green);
      margin-bottom: 14px; text-align: center;
    }
    #scanner-modal .scan-hint {
      font-size: 13px; color: var(--text-3);
      text-align: center; margin-top: 12px; margin-bottom: 14px;
    }
    /* override html5-qrcode default ugly border */
    #qr-reader { border: none !important; width: 100% !important; }
    #qr-reader video { border-radius: 10px; width: 100% !important; }
    #qr-reader__scan_region { border: 2px dashed var(--green) !important; border-radius: 8px; }
    /* hide the html5-qrcode footer link */
    #qr-reader__status_span, #qr-reader__header_message { display:none !important; }
    /* scan button in search area */
    .scan-btn {
      padding: 10px 14px;
      background: var(--green-light);
      border: 1.5px solid var(--green);
      border-radius: var(--radius-sm);
      color: var(--green);
      font-size: 18px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.15s;
      flex-shrink: 0;
    }
    .scan-btn:hover { background: var(--green); color: #fff; }
    body.dark .scan-btn { background: var(--green-light); }
    /* barcode result badge */
    .barcode-badge {
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--green-light); color: var(--green);
      border-radius: 20px; padding: 4px 12px;
      font-size: 13px; font-weight: 600; margin-bottom: 10px;
    }
  `;
  document.head.appendChild(style);
})();

// ── Scanner state ─────────────────────────────────────────────────────────────
var _html5QrScanner = null;

// ── Open camera scanner modal ─────────────────────────────────────────────────
function openScanner() {
  if (document.getElementById('scanner-modal')) return; // already open

  var modal = document.createElement('div');
  modal.id = 'scanner-modal';
  modal.innerHTML =
    '<div class="scan-box">'
    + '<div class="scan-title">📷 Naskenuj čárový kód</div>'
    + '<div id="qr-reader"></div>'
    + '<div class="scan-hint">Namiř kameru na čárový kód produktu (EAN-13 / EAN-8 / UPC)</div>'
    + '<button class="btn btn-ghost btn-sm" style="width:100%" onclick="closeScanner()">✕ Zrušit</button>'
    + '</div>';
  document.body.appendChild(modal);

  // tap outside box → close
  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeScanner();
  });

  try {
    _html5QrScanner = new Html5Qrcode('qr-reader');
    _html5QrScanner.start(
      { facingMode: 'environment' },
      {
        fps: 10,
        qrbox: { width: 260, height: 120 },
        // EAN-13, EAN-8, UPC-A, UPC-E, Code128 all enabled by default
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
        ]
      },
      function onSuccess(decodedText) {
        closeScanner();
        handleScannedBarcode(decodedText);
      },
      function onError() { /* ignore frame-level errors */ }
    ).catch(function (err) {
      console.error('Camera start error:', err);
      closeScanner();
      showToast('❌ Nelze spustit kameru — zkontrolujte oprávnění');
    });
  } catch (err) {
    console.error('Html5Qrcode init error:', err);
    closeScanner();
    showToast('❌ Scanner není k dispozici');
  }
}

// ── Close + clean up scanner ──────────────────────────────────────────────────
function closeScanner() {
  if (_html5QrScanner) {
    _html5QrScanner.stop().catch(function () { }).finally(function () {
      _html5QrScanner = null;
    });
  }
  var modal = document.getElementById('scanner-modal');
  if (modal) modal.remove();
}

// ── Handle a successfully scanned barcode ─────────────────────────────────────
async function handleScannedBarcode(barcode) {
  // Fill the search input so user can see what was scanned
  var input = document.getElementById('search-input');
  if (input) input.value = '';

  var results = document.getElementById('search-results');
  if (!results) return;

  results.innerHTML =
    '<div class="barcode-badge">🔖 ' + barcode + '</div>'
    + '<div class="loading-text">Hledám produkt...</div>';

  var data = await api('products?barcode=' + encodeURIComponent(barcode));

  if (!data || !data.length) {
    results.innerHTML =
      '<div class="barcode-badge">🔖 ' + barcode + '</div>'
      + '<div class="loading-text">Produkt nenalezen — zkuste textové vyhledávání</div>';
    return;
  }

  // Reuse the same render logic as searchFood
  productsCache = {};
  data.forEach(function (p) { productsCache[p.id] = p; });

  var html = '<div class="barcode-badge">🔖 ' + barcode + '</div>';
  data.forEach(function (p) {
    var imgHtml = p.image_url
      ? '<img class="product-img" src="' + p.image_url + '" alt="">'
      : '<div class="product-img-placeholder">🥫</div>';
    var macros = p.calories + ' kcal/100g'
      + ' · B' + (p.protein_g != null ? p.protein_g : '?') + 'g'
      + ' T' + (p.fat_g != null ? p.fat_g : '?') + 'g'
      + ' S' + (p.carbs_g != null ? p.carbs_g : '?') + 'g';
    html += '<div class="product-result">'
      + imgHtml
      + '<div class="product-info">'
      + '<div class="product-name">' + p.name + '</div>'
      + '<div class="product-kcal">' + macros + '</div>'
      + '</div>'
      + '<div class="product-add">'
      + '<input type="number" class="grams-input" data-pid="' + p.id + '" value="100" min="1" style="width:60px"/>'
      + '<button class="btn btn-primary btn-sm add-btn" data-pid="' + p.id + '">+</button>'
      + '</div></div>';
  });
  results.innerHTML = html;

  results.querySelectorAll('.add-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var pid = btn.getAttribute('data-pid');
      var inp = results.querySelector('.grams-input[data-pid="' + pid + '"]');
      var grams = parseInt(inp ? inp.value : 100) || 100;
      addMeal(pid, grams);
    });
  });
}
// ═══════════════════════════════════════════════════════
//  MANUAL PRODUCT MODAL
// ═══════════════════════════════════════════════════════

var manualTab = 'manual';
var _parsedNutrition = {};

function openManualProduct() {
  if (document.getElementById('manual-modal')) return;

  var modal = document.createElement('div');
  modal.id = 'manual-modal';
  modal.innerHTML = buildManualModal();
  document.body.appendChild(modal);

  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeManualModal();
  });

  modal.querySelectorAll('.mm-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      manualTab = btn.dataset.tab;

      modal.querySelectorAll('.mm-tab').forEach(function (b) {
        b.classList.remove('active');
      });

      modal.querySelectorAll('.mm-pane').forEach(function (p) {
        p.classList.remove('active');
      });

      btn.classList.add('active');
      modal.querySelector('.mm-pane[data-pane="' + manualTab + '"]').classList.add('active');
    });
  });
}

function closeManualModal() {
  var modal = document.getElementById('manual-modal');
  if (modal) modal.remove();
}

function buildManualModal() {
  return '<div class="mm-box">'
    + '<div class="mm-handle"></div>'
    + '<div class="mm-title">➕ Přidat vlastní produkt</div>'

    + '<div class="mm-tabs">'
    + '<button class="mm-tab' + (manualTab === 'manual' ? ' active' : '') + '" data-tab="manual">✏️ Ručně</button>'
    + '<button class="mm-tab' + (manualTab === 'paste' ? ' active' : '') + '" data-tab="paste">📋 Vložit text</button>'
    + '</div>'

    + '<div class="mm-pane' + (manualTab === 'manual' ? ' active' : '') + '" data-pane="manual">'
    + '<div class="field"><label>Název produktu</label>'
    + '<input type="text" id="mm-name" placeholder="např. Jogurt jahoda Tesco"></div>'

    + '<div class="field" style="margin-bottom:6px"><label>Hodnoty na 100 g</label></div>'

    + '<div class="mm-grid">'
    + mmField('mm-cal', 'Kalorie kcal', '0')
    + mmField('mm-prot', 'Bílkoviny g', '0')
    + mmField('mm-fat', 'Tuky g', '0')
    + mmField('mm-carb', 'Sacharidy g', '0')
    + mmField('mm-fib', 'Vláknina g', '0')
    + mmField('mm-salt', 'Sůl g', '0')
    + '</div>'

    + '<div class="field"><label>Gramáž porce (g)</label>'
    + '<input type="number" id="mm-grams" value="100" min="1"></div>'

    + '<button class="btn btn-primary" onclick="saveManualProduct()">✓ Přidat do deníku</button>'
    + '</div>'

    + '<div class="mm-pane' + (manualTab === 'paste' ? ' active' : '') + '" data-pane="paste">'
    + '<div class="parse-hint">'
    + 'Vyfoť etiketu přes <strong>Google Lens</strong> nebo <strong>Google Překladač</strong>, zkopíruj text a vlož sem:'
    + '</div>'

    + '<textarea class="paste-area" id="mm-paste-text" placeholder="Energie 1467 kJ / 350 kcal&#10;Bílkoviny 12,5 g&#10;Tuky 8,3 g&#10;Sacharidy 45,2 g&#10;Vláknina 2,1 g&#10;Sůl 0,8 g"></textarea>'

    + '<button class="btn btn-ghost btn-sm" style="width:100%;margin-bottom:10px" onclick="parseAndPreview()">🔍 Rozpoznat hodnoty</button>'

    + '<div id="mm-parse-preview" style="display:none"></div>'

    + '<div class="field"><label>Název produktu</label>'
    + '<div class="field"><label>Čárový kód (EAN) — nepovinné</label>'
    + '<div style="display:flex;gap:6px">'
    + '<input type="text" id="mm-barcode" inputmode="numeric" placeholder="8594000205137" '
    + 'style="flex:1;font-family:\'DM Mono\',monospace"/>'
    + '<button class="scan-btn" style="padding:10px 12px" onclick="scanForManual()" title="Skenovat">📷</button>'
    + '</div>'
    + '<div style="font-size:11px;color:var(--text-3);margin-top:3px">Po uložení bude dohledatelný i skenem</div></div>'
    + '<input type="text" id="mm-paste-name" placeholder="Zadej název ručně"></div>'

    + '<div class="field"><label>Gramáž porce (g)</label>'
    + '<input type="number" id="mm-paste-grams" value="100" min="1"></div>'

    + '<button class="btn btn-primary" onclick="savePastedProduct()">✓ Přidat do deníku</button>'
    + '</div>'

    + '</div>';
}

function mmField(id, label, placeholder) {
  return '<div class="field">'
    + '<label>' + label + '</label>'
    + '<input type="number" id="' + id + '" placeholder="' + placeholder + '" min="0" step="0.1">'
    + '</div>';
}

function parseNutritionText(raw) {
  var t = raw.replace(/,/g, '.').replace(/\u00a0/g, ' ');

  function extract(patterns) {
    for (var i = 0; i < patterns.length; i++) {
      var m = t.match(patterns[i]);
      if (m) {
        var v = parseFloat(m[1]);
        if (!isNaN(v)) return v;
      }
    }
    return null;
  }

  var kcalLine = t.match(/(\d+(?:\.\d+)?)\s*kcal/i);
  var calories = kcalLine ? parseFloat(kcalLine[1]) : null;

  if (!calories) {
    var kjLine = t.match(/(\d+(?:\.\d+)?)\s*kj/i);
    if (kjLine) calories = Math.round(parseFloat(kjLine[1]) / 4.184);
  }

  var protein = extract([
    /b[ií]lkovin[ay]?\s+(\d+(?:\.\d+)?)/i,
    /protein[s]?\s*[:\/]?\s*(\d+(?:\.\d+)?)/i
  ]);

  var fat = extract([
    /tuk[yů]?\s+(\d+(?:\.\d+)?)/i,
    /fat\s*[:\/]?\s*(\d+(?:\.\d+)?)/i
  ]);

  var carbs = extract([
    /sacharid[yů]?\s+(\d+(?:\.\d+)?)/i,
    /carbohydrate[s]?\s*[:\/]?\s*(\d+(?:\.\d+)?)/i
  ]);

  var fiber = extract([
    /vl[aá]knin[ay]?\s+(\d+(?:\.\d+)?)/i,
    /fiber\s*[:\/]?\s*(\d+(?:\.\d+)?)/i,
    /fibre\s*[:\/]?\s*(\d+(?:\.\d+)?)/i
  ]);

  var salt = extract([
    /s[uů]l\s+(\d+(?:\.\d+)?)/i,
    /salt\s*[:\/]?\s*(\d+(?:\.\d+)?)/i,
    /sodium\s*[:\/]?\s*(\d+(?:\.\d+)?)/i
  ]);

  if (salt && t.match(/sodium/i) && !t.match(/s[uů]l/i)) {
    salt = Math.round(salt * 2.5 * 10) / 10;
  }

  return { calories: calories, protein: protein, fat: fat, carbs: carbs, fiber: fiber, salt: salt };
}

function parseAndPreview() {
  var raw = document.getElementById('mm-paste-text') ? document.getElementById('mm-paste-text').value : '';

  if (!raw.trim()) {
    showToast('⚠ Vložte text z etikety');
    return;
  }

  _parsedNutrition = parseNutritionText(raw);

  var prev = document.getElementById('mm-parse-preview');
  if (!prev) return;

  var rows = [
    ['Kalorie', _parsedNutrition.calories, 'kcal'],
    ['Bílkoviny', _parsedNutrition.protein, 'g'],
    ['Tuky', _parsedNutrition.fat, 'g'],
    ['Sacharidy', _parsedNutrition.carbs, 'g'],
    ['Vláknina', _parsedNutrition.fiber, 'g'],
    ['Sůl', _parsedNutrition.salt, 'g']
  ];

  var html = '<div class="parse-preview">'
    + '<strong>Rozpoznané hodnoty na 100 g:</strong><br><br>';

  rows.forEach(function (r) {
    html += '<div class="parse-row"><span>' + r[0] + '</span><span>'
      + (r[1] != null ? r[1] + ' ' + r[2] : '—')
      + '</span></div>';
  });

  html += '</div>';

  prev.style.display = 'block';
  prev.innerHTML = html;
}

async function saveManualProduct() {
  var name = document.getElementById('mm-name') ? document.getElementById('mm-name').value.trim() : '';
  var cal = parseFloat(document.getElementById('mm-cal') ? document.getElementById('mm-cal').value : '') || null;
  var prot = parseFloat(document.getElementById('mm-prot') ? document.getElementById('mm-prot').value : '') || null;
  var fat = parseFloat(document.getElementById('mm-fat') ? document.getElementById('mm-fat').value : '') || null;
  var carb = parseFloat(document.getElementById('mm-carb') ? document.getElementById('mm-carb').value : '') || null;
  var fib = parseFloat(document.getElementById('mm-fib') ? document.getElementById('mm-fib').value : '') || null;
  var salt = parseFloat(document.getElementById('mm-salt') ? document.getElementById('mm-salt').value : '') || null;
  var grams = parseInt(document.getElementById('mm-grams') ? document.getElementById('mm-grams').value : '100') || 100;
  var barcode = document.getElementById('mm-barcode')?.value.trim() || null;
  if (!name) {
    showToast('⚠ Zadejte název produktu');
    return;
  }

  if (!cal) {
    showToast('⚠ Zadejte kalorie');
    return;
  }

  await addCustomProduct({ name: name, cal: cal, prot: prot, fat: fat, carb: carb, fib: fib, salt: salt, grams: grams, barcode: barcode });
}

async function savePastedProduct() {
  var name = document.getElementById('mm-paste-name') ? document.getElementById('mm-paste-name').value.trim() : '';
  var grams = parseInt(document.getElementById('mm-paste-grams') ? document.getElementById('mm-paste-grams').value : '100') || 100;

  if (!name) {
    showToast('⚠ Zadejte název produktu');
    return;
  }

  if (!_parsedNutrition.calories) {
    showToast('⚠ Nejprve klikněte Rozpoznat hodnoty');
    return;
  }

  await addCustomProduct({
    name: name,
    cal: _parsedNutrition.calories,
    prot: _parsedNutrition.protein,
    fat: _parsedNutrition.fat,
    carb: _parsedNutrition.carbs,
    fib: _parsedNutrition.fiber,
    salt: _parsedNutrition.salt,
    grams: grams
  });
}

async function addCustomProduct(o) {
  var saved = await api('products/manual', {
    method: 'POST',
    body: JSON.stringify({
      name: o.name,
      calories: o.cal,
      protein_g: o.prot,
      fat_g: o.fat,
      carbs_g: o.carb,
      fiber_g: o.fib,
      salt_g: o.salt,
      source: 'manual'
    })
  });

  if (!saved || !saved.id) {
    showToast('❌ Nepodařilo se uložit produkt');
    return;
  }

  await api('meals', {
    method: 'POST',
    body: JSON.stringify({
      product_id: saved.id,
      weight_g: o.grams,
      meal_type: 'snack'
    })
  });

  closeManualModal();
  showToast('✓ ' + o.name + ' přidáno');
  await loadMeals();
}
function scanForManual() {
  // Открываем сканер, но при успехе просто вставляем в поле
  if (document.getElementById('scanner-modal')) return;
  var modal = document.createElement('div');
  modal.id = 'scanner-modal';
  modal.innerHTML = '<div class="scan-box"><div class="scan-title">📷 Naskenuj čárový kód</div>'
    + '<div id="qr-reader"></div>'
    + '<button class="btn btn-ghost btn-sm" style="width:100%;margin-top:12px" onclick="closeScanner()">✕ Zrušit</button></div>';
  document.body.appendChild(modal);

  _html5QrScanner = new Html5Qrcode('qr-reader');
  _html5QrScanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 120 } },
    function (code) {
      closeScanner();
      
      var field = document.getElementById('mm-barcode') || document.getElementById('mm-paste-barcode');
      if (field) { field.value = code; showToast('✓ Kód naskenován: ' + code); }
    },
    function () { }
  );
} 
router();