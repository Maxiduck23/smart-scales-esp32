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

// ── Local cache ───────────────────────────────────────
var CACHE_PREFIX = 'cv_cache_';
var LOG_KEY = 'cv_status_logs';

function cacheSet(key, value, ttlMs) {
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ value: value, expiresAt: Date.now() + ttlMs })); }
  catch (e) { console.warn('Cache write failed:', e); }
}
function cacheGet(key) {
  try {
    var raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    var payload = JSON.parse(raw);
    if (!payload || Date.now() > payload.expiresAt) { localStorage.removeItem(CACHE_PREFIX + key); return null; }
    return payload.value;
  } catch (e) { return null; }
}
function cacheRemove(key) { localStorage.removeItem(CACHE_PREFIX + key); }
function cacheClearAll() {
  Object.keys(localStorage).forEach(function (k) { if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k); });
}

// ── Status logs ───────────────────────────────────────
function addStatusLog(type, message, extra) {
  var logs = [];
  try { logs = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (e) { logs = []; }
  logs.unshift({ type: type || 'info', message: message, extra: extra || null, time: new Date().toISOString() });
  logs = logs.slice(0, 50);
  localStorage.setItem(LOG_KEY, JSON.stringify(logs));
  var box = document.getElementById('status-log-list');
  if (box) renderStatusLogs();
}
function getStatusLogs() {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (e) { return []; }
}
function formatLogTime(iso) {
  return new Date(iso).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function renderStatusLogs() {
  var box = document.getElementById('status-log-list');
  if (!box) return;
  var logs = getStatusLogs();
  if (!logs.length) { box.innerHTML = '<div class="empty">Zatím žádné logy</div>'; return; }
  var html = '';
  logs.slice(0, 8).forEach(function (log) {
    var icon = log.type === 'error' ? '❌' : log.type === 'success' ? '✅' : log.type === 'weight' ? '<img src="/logo.svg" class="status-logo-img" alt="">' : 'ℹ️';
    html += '<div class="status-log-item"><span class="status-log-icon">' + icon + '</span>'
      + '<div class="status-log-main"><div class="status-log-msg">' + escapeHtml(log.message) + '</div>'
      + '<div class="status-log-time">' + formatLogTime(log.time) + '</div></div></div>';
  });
  box.innerHTML = html;
}
function escapeHtml(str) {
  return String(str || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

// ── API ───────────────────────────────────────────────
async function api(path, options) {
  options = options || {};
  try {
    var res = await fetch('/api/' + path, Object.assign({}, options, {
      headers: Object.assign({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() }, options.headers || {})
    }));
    if (res.status === 401) { addStatusLog('error', 'Relace vypršela, přihlaste se znovu'); logout(); return null; }
    var data = await res.json().catch(function () { return null; });
    if (!res.ok) { addStatusLog('error', 'API chyba: ' + path, data && data.error ? data.error : null); return data || null; }
    return data;
  } catch (e) { console.error('API error:', e); addStatusLog('error', 'Chyba připojení k API: ' + path); return null; }
}

// ── State ─────────────────────────────────────────────
var currentPage = 'dashboard';
var weightIntervalId = null;
var searchTimer = null;
var cachedProfile = null;
var cachedMacroGoals = { calories: 2000, protein: 150, carbs: 250, fat: 65 };
var favoritesCache = {};
var mealsCache = {};
var productsCache = {};
var darkMode = localStorage.getItem('cv_dark') === '1';
var waterReminderIntervalId = null;
var waterReminderToastOpen = false;

function clearWeightInterval() {
  if (weightIntervalId) { clearInterval(weightIntervalId); weightIntervalId = null; }
}
function applyTheme() { document.body.classList.toggle('dark', darkMode); }

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
    btn.className = 'toast-undo'; btn.textContent = 'Zpět';
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
      + '<span class="nav-icon">' + item.icon + '</span><span>' + item.label + '</span></button>';
  });
  return html + '</nav>';
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
  var topbar = document.querySelector('.topbar');
  if (topbar) topbar.outerHTML = renderTopbar(currentPage === 'dashboard' ? 'Chytrá váha' : currentPage === 'stats' ? 'Statistiky' : 'Profil');
}

// ═══════════════════════════════════════════════════════
//  GREETING
// ═══════════════════════════════════════════════════════
function getGreeting() {
  var h = new Date().getHours();
  if (h >= 6 && h < 12) return { text: 'Dobré ráno! Připraveni na snídani?', emoji: '🌅', period: 'Ráno · ' + formatHourRange(), cssClass: 'morning' };
  if (h >= 12 && h < 18) return { text: 'Čas oběda. Co budeme vážit?', emoji: '☀️', period: 'Poledne · ' + formatHourRange(), cssClass: 'noon' };
  return { text: 'Lehká večeře? Nezapomeň zapsat kalorie.', emoji: '🌙', period: 'Večer · ' + formatHourRange(), cssClass: 'evening' };
}
function formatHourRange() {
  return new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
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
    + '<div class="field"><label>Email</label><input type="email" id="login-email" placeholder="vas@email.cz" autocomplete="email"/></div>'
    + '<div class="field"><label>Heslo</label><input type="password" id="login-pass" placeholder="••••••••" autocomplete="current-password"/></div>'
    + '<button class="btn btn-primary" onclick="doLogin()">Přihlásit se</button>'
    + '<div class="auth-link">Nemáte účet? <a onclick="renderRegisterPage()">Registrovat se</a></div>'
    + '</div></div>';
  document.getElementById('login-pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
}

async function doLogin() {
  var email = document.getElementById('login-email').value.trim();
  var pass = document.getElementById('login-pass').value;
  var err = document.getElementById('err');
  err.style.display = 'none';
  if (!email || !pass) { err.textContent = 'Vyplňte email a heslo'; err.style.display = 'block'; return; }
  showToast('Přihlašuji...');
  // ✅ FIX: data declared BEFORE console.log
  var data = await api('auth/login', { method: 'POST', body: JSON.stringify({ email: email, password: pass }) });
  if (data && data.token) {
    saveToken(data.token);
    saveUser({ name: data.name, email: email });
    requestNotificationPermission(); // ✅ FIX: voláme funkci, ne definujeme ji
    router();
    showToast('Přihlášení úspěšné');
    addStatusLog('success', 'Přihlášení úspěšné');
  } else {
    err.textContent = (data && data.error) ? data.error : 'Chyba přihlášení';
    err.style.display = 'block';
    showToast('Chybné údaje');
    addStatusLog('error', 'Chybné údaje');
  }
}

// ✅ FIX: funkce na správném místě jako globální, ne zanořená uvnitř doLogin/doRegister
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(function () { });
  }
}

// ═══════════════════════════════════════════════════════
//  REGISTER (2 steps)
// ═══════════════════════════════════════════════════════
var regData = {};

function renderRegisterPage(step) {
  step = step || 1;
  document.getElementById('app').innerHTML =
    '<div class="auth-wrap">'
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
  if (step === 2) initGoalTabs();
}

function renderRegStep1() {
  return '<div class="field"><label>Jméno</label><input type="text" id="reg-name" placeholder="Vaše jméno" value="' + (regData.name || '') + '"/></div>'
    + '<div class="field"><label>Email</label><input type="email" id="reg-email" placeholder="vas@email.cz" value="' + (regData.email || '') + '"/></div>'
    + '<div class="field"><label>Heslo</label><input type="password" id="reg-pass" placeholder="min. 6 znaků"/></div>'
    + '<button class="btn btn-primary" onclick="regStep1Next()">Pokračovat →</button>';
}

function renderRegStep2() {
  var goalLabels = { lose: 'Zhubnout', muscle: 'Nabrat svaly', fit: 'Být fit' };
  var tabsHtml = '<div class="goal-tabs" id="goal-tabs">';
  ['lose', 'muscle', 'fit'].forEach(function (g) {
    tabsHtml += '<button data-val="' + g + '" class="' + ((regData.goal || 'lose') === g ? 'active' : '') + '">' + goalLabels[g] + '</button>';
  });
  tabsHtml += '</div>';
  return '<div class="field"><label>Cíl</label>' + tabsHtml + '</div>'
    + '<div class="row-2">'
    + '<div class="field"><label>Rok narození</label><input type="number" id="reg-year" placeholder="2000" value="' + (regData.birth_year || '') + '" min="1950" max="2010"/></div>'
    + '<div class="field"><label>Výška (cm)</label><input type="number" id="reg-height" placeholder="170" value="' + (regData.height_cm || '') + '"/></div>'
    + '</div><div class="row-2">'
    + '<div class="field"><label>Hmotnost (kg)</label><input type="number" id="reg-weight" placeholder="70" value="' + (regData.weight_kg || '') + '"/></div>'
    + '<div class="field"><label>Cíl. hmotnost</label><input type="number" id="reg-gweight" placeholder="65" value="' + (regData.goal_weight_kg || '') + '"/></div>'
    + '</div>'
    + '<div class="field"><label>Aktivita</label><select id="reg-activity">'
    + '<option value="sedentary">Sedavý</option><option value="light" selected>Lehce aktivní</option>'
    + '<option value="moderate">Středně aktivní</option><option value="active">Velmi aktivní</option>'
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
    name: regData.name, email: regData.email, password: regData.password, goal: regData.goal || 'lose',
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
    requestNotificationPermission(); // ✅ FIX: voláme funkci
    router();
    showToast('Registrace úspěšná');
    addStatusLog('success', 'Registrace úspěšná');
  } else {
    err.textContent = (data && data.error) ? data.error : 'Chyba registrace';
    err.style.display = 'block';
    showToast('Chyba registrace');
    addStatusLog('error', 'Chyba registrace');
  }
}

// ═══════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════
async function renderDashboard() {
  var app = document.getElementById('app');
  var g = getGreeting();

  app.innerHTML = renderTopbar('Chytrá váha')
    + '<div class="page" id="dash-page">'
    + '<div class="greeting-hero ' + g.cssClass + '">'
    + '<div class="greeting-emoji">' + g.emoji + '</div>'
    + '<div class="greeting-time">' + g.period + '</div>'
    + '<div class="greeting-text">' + g.text + '</div>'
    + '</div>'
    + '<div class="weight-hero">'
    + '<div class="weight-hero-left">'
    + '<div class="weight-hero-label">Aktuální váha ze senzoru</div>'
    + '<div class="weight-hero-value" id="w-val">--<span>g</span></div>'
    + '<div class="weight-hero-status"><div class="status-dot" id="w-dot"></div><span id="w-status">Čekám na váhu...</span></div>'
    + '</div>'
    + '<div class="weight-hero-icon"><img src="/logo.svg" alt=""/></div>'
    + '</div>'
    + '<div class="macro-grid">'
    + macroBox('kcal', '--', 'kcal', 'Energie', 'mb-kcal')
    + macroBox('protein', '--', 'g', 'Bílkoviny', 'mb-protein')
    + macroBox('carbs', '--', 'g', 'Sacharidy', 'mb-carbs')
    + macroBox('fat', '--', 'g', 'Tuky', 'mb-fat')
    + '</div>'
    + '<div class="section-card">'
    + '<div class="section-title">Denní cíle</div>'
    + barRowHtml('Kalorie', 'bar-cal', '#f57c00')
    + barRowHtml('Bílkoviny', 'bar-pro', '#1565c0')
    + barRowHtml('Sacharidy', 'bar-carb', '#43a047')
    + barRowHtml('Tuky', 'bar-fat', '#6a1b9a')
    + '</div>'
    + '<div class="section-card">'
    + '<div class="section-title">🔍 Přidat jídlo</div>'
    + '<div class="search-wrap">'
    + '<input type="text" id="search-input" placeholder="Hledat nebo zadat čárový kód..."/>'
    + '<button class="btn btn-primary btn-sm" onclick="searchFood()">🔍</button>'
    + '<button class="scan-btn" onclick="openScanner()" title="Skenovat">📷</button>'
    + '<button class="manual-open-btn" onclick="openManualProduct()" title="Přidat vlastní">➕</button>'
    + '</div>'
    + '<div id="search-results"></div>'
    + '</div>'
    + '<div class="section-card">'
    + '<div class="section-title"><span>Dnes jsem jedl</span><span id="total-kcal-badge" style="font-size:12px;color:var(--text-3);font-weight:400"></span></div>'
    + '<div id="meals-list"><div class="spinner"></div></div>'
    + '</div>'
    + '<div class="section-card">'
    + '<div class="section-title">⭐ Oblíbená jídla</div>'
    + '<div id="favorite-products"><div class="spinner"></div></div>'
    + '</div>'
    + '<div class="section-card water-card">'
    + '<div class="section-title"><span>💧 Voda</span><span class="water-reminder-chip" id="water-reminder-chip">Připomínka vypnuta</span></div>'
    + '<div class="water-summary">'
    + '<div><div class="water-label" id="water-label">0 ml / 2500 ml</div><div class="water-hint" id="water-hint">Dnes zatím žádná voda</div></div>'
    + '<div class="water-drop">💧</div>'
    + '</div>'
    + '<div class="water-fill-wrap"><div class="water-fill-wave" id="water-fill" style="width:0%"></div></div>'
    + '<div class="water-grid">'
    + '<button class="water-cell" onclick="addWater(250)">+250 ml</button>'
    + '<button class="water-cell" onclick="addWater(500)">+500 ml</button>'
    + '<button class="water-cell" onclick="addWater(750)">+750 ml</button>'
    + '<button class="water-cell" onclick="addWater(1000)">+1000 ml</button>'
    + '<button class="water-cell muted" onclick="setWater(0)">Reset</button>'
    + '</div>'
    + '<div class="water-settings">'
    + '<label class="water-toggle"><input type="checkbox" id="water-reminder-enabled"/> Připomínat pít vodu</label>'
    + '<div class="water-setting-row">'
    + '<label>Denní cíl<input type="number" id="water-goal-input" min="500" max="6000" step="100" value="2500"></label>'
    + '<label>Interval (min)<input type="number" id="water-interval-input" min="15" max="240" step="15" value="60"></label>'
    + '</div>'
    + '<button class="btn btn-primary btn-sm" onclick="saveWaterReminderSettings()">Uložit připomínku</button>'
    + '</div>'
    + '</div>'
    + '</div>'
    + renderNav('dashboard');

  var si = document.getElementById('search-input');
  if (si) {
    si.addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(searchFood, 480); });
    si.addEventListener('keydown', function (e) { if (e.key === 'Enter') searchFood(); });
  }

  startWeightPolling();
  await loadMealsAndProfile();
  await loadFavorites();
  renderFavoriteProducts();
  initWaterTracking();
  addStatusLog('info', 'Dashboard načten');
}

// ✅ FIX: visibilitychange listener MIMO renderDashboard — přidá se jen jednou
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') { checkWaterReminder(); updateWaterUi(); }
});
window.addEventListener('focus', function () { checkWaterReminder(); updateWaterUi(); });

function macroBox(cls, val, unit, lbl, id) {
  return '<div class="macro-box ' + cls + '"><div class="macro-val" id="' + id + '">' + val + '<small>' + unit + '</small></div><div class="macro-lbl">' + lbl + '</div></div>';
}
function barRowHtml(name, id, color) {
  return '<div class="bar-row"><div class="bar-head"><span class="bar-name">' + name + '</span><span class="bar-nums" id="v-' + id + '">--</span></div>'
    + '<div class="bar-track"><div class="bar-fill" id="' + id + '" style="width:0%;background:' + color + '"></div></div></div>';
}
function barRow(name, id, color) { return barRowHtml(name, id, color); }

// ── Weight polling ────────────────────────────────────
var _lastWeightReceivedAt = 0;
var WEIGHT_TIMEOUT_MS = 10000; // 10 sekund bez dat → reset

function startWeightPolling() {
  clearWeightInterval();
  weightIntervalId = setInterval(async function () {
    var valEl = document.getElementById('w-val');
    if (!valEl) { clearWeightInterval(); return; }

    var data = await api('weight');

    if (data && data.grams != null) {
      // Máme data → aktualizuj
      _lastWeightReceivedAt = Date.now();
      valEl.innerHTML = data.grams + '<span>g</span>';
      var dot = document.getElementById('w-dot');
      var st = document.getElementById('w-status');
      if (dot) dot.classList.add('active');
      if (st) st.textContent = '✓ Váha stabilizována';

      // Pokud váha poslala produkt, zobraz ho
      if (data.product && data.product.name) {
        var prodEl = document.getElementById('w-product');
        if (prodEl) {
          prodEl.textContent = data.product.name;
          prodEl.style.display = 'block';
        }
      }
    } else {
      // Žádná data — zkontroluj timeout
      var elapsed = Date.now() - _lastWeightReceivedAt;
      if (_lastWeightReceivedAt > 0 && elapsed > WEIGHT_TIMEOUT_MS) {
        // Reset
        valEl.innerHTML = '--<span>g</span>';
        var dot = document.getElementById('w-dot');
        var st = document.getElementById('w-status');
        if (dot) dot.classList.remove('active');
        if (st) st.textContent = 'Čekám na váhu...';
        var prodEl = document.getElementById('w-product');
        if (prodEl) prodEl.style.display = 'none';
        _lastWeightReceivedAt = 0; // jen jednou resetujeme
      }
    }
  }, 500); // 500ms místo 1000ms — 2× rychlejší
}


// ── Macros ────────────────────────────────────────────
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
  if (!cachedProfile) { cachedProfile = await api('profile'); if (cachedProfile) cachedMacroGoals = calcMacroGoals(cachedProfile); }
  await loadMeals();
}

async function loadMeals() {
  var data = await api('meals');
  if (!data) return;
  var t = data.totals || {}, g = cachedMacroGoals;
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
  if (!data.meals || !data.meals.length) { list.innerHTML = '<div class="empty"><div class="empty-icon">🍽️</div>Zatím nic přidáno</div>'; return; }
  mealsCache = {};
  data.meals.forEach(function (m) { mealsCache[m.id] = m; });
  var html = '';
  data.meals.forEach(function (m) {
    var kcal = Math.round((m.products && m.products.calories ? m.products.calories : 0) * m.weight_g / 100);
    var name = m.products && m.products.name ? m.products.name : '?';
    html += '<div class="meal-item" id="meal-' + m.id + '">'
      + '<div class="meal-dot"></div><div class="meal-info">'
      + '<div class="meal-name">' + name + '</div>'
      + '<div class="meal-meta">' + m.weight_g + ' g · ' + kcal + ' kcal</div></div>'
      + '<span class="meal-kcal">' + kcal + ' kcal</span>'
      + '<button class="btn btn-danger btn-sm del-btn" data-mid="' + m.id + '">✕</button></div>';
  });
  list.innerHTML = html;
  list.querySelectorAll('.del-btn').forEach(function (btn) {
    btn.addEventListener('click', function () { deleteMeal(btn.getAttribute('data-mid')); });
  });
}

function setEl(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; }
function setBar(barId, val, goal, label) {
  var bar = document.getElementById(barId), lbl = document.getElementById('v-' + barId);
  if (bar) bar.style.width = Math.min(val / goal * 100, 100) + '%';
  if (lbl) lbl.textContent = label;
}

// ── Water tracking ────────────────────────────────────
var WATER_STATE_KEY = 'cv_water_state';
var WATER_SETTINGS_KEY = 'cv_water_settings';

function getTodayKey() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function getWaterSettings() {
  var defaults = { goalMl: 2500, intervalMinutes: 60, enabled: false, lastReminderAt: 0 };
  try { return Object.assign(defaults, JSON.parse(localStorage.getItem(WATER_SETTINGS_KEY) || '{}')); }
  catch (e) { return defaults; }
}
function saveWaterSettings(s) { localStorage.setItem(WATER_SETTINGS_KEY, JSON.stringify(s)); }
function getWaterState() {
  var today = getTodayKey();
  try {
    var state = JSON.parse(localStorage.getItem(WATER_STATE_KEY) || 'null');
    if (!state || state.date !== today) return { date: today, amountMl: 0, lastDrinkAt: null };
    return Object.assign({ date: today, amountMl: 0, lastDrinkAt: null }, state);
  } catch (e) { return { date: today, amountMl: 0, lastDrinkAt: null }; }
}
function saveWaterState(s) { localStorage.setItem(WATER_STATE_KEY, JSON.stringify(s)); }

function initWaterTracking() {
  var settings = getWaterSettings();
  var enabled = document.getElementById('water-reminder-enabled');
  var goal = document.getElementById('water-goal-input');
  var interval = document.getElementById('water-interval-input');
  if (enabled) enabled.checked = !!settings.enabled;
  if (goal) goal.value = settings.goalMl;
  if (interval) interval.value = settings.intervalMinutes;
  updateWaterUi();
  startWaterReminderLoop();
}

function updateWaterUi() {
  var state = getWaterState();
  var settings = getWaterSettings();
  var pct = Math.min(100, Math.round((state.amountMl / settings.goalMl) * 100));
  var label = document.getElementById('water-label');
  var hint = document.getElementById('water-hint');
  var fill = document.getElementById('water-fill');
  var chip = document.getElementById('water-reminder-chip');
  if (label) label.textContent = state.amountMl + ' ml / ' + settings.goalMl + ' ml';
  if (fill) fill.style.width = pct + '%';
  if (hint) {
    if (state.amountMl >= settings.goalMl) hint.textContent = 'Skvělé! Denní cíl je splněn.';
    else if (state.lastDrinkAt) hint.textContent = 'Poslední sklenice: ' + formatLogTime(state.lastDrinkAt) + ' · splněno ' + pct + '%';
    else hint.textContent = 'Dnes zatím žádná voda · splněno ' + pct + '%';
  }
  if (chip) {
    chip.textContent = settings.enabled ? 'Každých ' + settings.intervalMinutes + ' min' : 'Připomínka vypnuta';
    chip.classList.toggle('active', !!settings.enabled);
  }
}

function addWater(amountMl) {
  var state = getWaterState(), settings = getWaterSettings();
  state.amountMl = Math.max(0, state.amountMl + amountMl);
  state.lastDrinkAt = new Date().toISOString();
  settings.lastReminderAt = Date.now();
  saveWaterState(state); saveWaterSettings(settings);
  updateWaterUi();
  addStatusLog('info', 'Vypito ' + amountMl + ' ml vody');
  showToast(state.amountMl >= settings.goalMl ? '🏆 Denní cíl vody splněn!' : '💧 Přidáno ' + amountMl + ' ml vody');
}

function setWater(amountMl) {
  var state = getWaterState();
  state.amountMl = Math.max(0, amountMl);
  state.lastDrinkAt = amountMl > 0 ? new Date().toISOString() : null;
  saveWaterState(state); updateWaterUi();
  showToast(amountMl > 0 ? '💧 Voda upravena' : '💧 Voda resetována');
}

function saveWaterReminderSettings() {
  var goal = parseInt(document.getElementById('water-goal-input') ? document.getElementById('water-goal-input').value : '2500', 10);
  var interval = parseInt(document.getElementById('water-interval-input') ? document.getElementById('water-interval-input').value : '60', 10);
  var enabled = !!(document.getElementById('water-reminder-enabled') && document.getElementById('water-reminder-enabled').checked);
  if (!goal || goal < 500 || goal > 6000) { showToast('⚠ Denní cíl musí být 500–6000 ml'); return; }
  if (!interval || interval < 15 || interval > 240) { showToast('⚠ Interval musí být 15–240 minut'); return; }
  var settings = getWaterSettings();
  settings.goalMl = goal; settings.intervalMinutes = interval; settings.enabled = enabled; settings.lastReminderAt = Date.now();
  saveWaterSettings(settings);
  if (enabled) requestNotificationPermission();
  updateWaterUi(); startWaterReminderLoop();
  showToast(enabled ? '💧 Připomínka vody zapnuta' : 'Připomínka vody vypnuta');
}

function startWaterReminderLoop() {
  if (waterReminderIntervalId) clearInterval(waterReminderIntervalId);
  waterReminderIntervalId = setInterval(checkWaterReminder, 60 * 1000);
  checkWaterReminder();
}

function checkWaterReminder() {
  if (!getToken()) return;
  var settings = getWaterSettings();
  if (!settings.enabled) return;
  var state = getWaterState();
  if (state.amountMl >= settings.goalMl) return;
  var dueMs = settings.intervalMinutes * 60 * 1000;
  var lastEventAt = Math.max(settings.lastReminderAt || 0, state.lastDrinkAt ? new Date(state.lastDrinkAt).getTime() : 0);
  if (Date.now() - lastEventAt < dueMs) return;
  settings.lastReminderAt = Date.now();
  saveWaterSettings(settings);
  showWaterReminderPopup();
}

function showWaterReminderPopup() {
  if (waterReminderToastOpen) return;
  waterReminderToastOpen = true;
  var state = getWaterState();
  var settings = getWaterSettings();
  var remaining = Math.max(settings.goalMl - state.amountMl, 0);
  var container = document.getElementById('toast-container');
  if (container) {
    var toast = document.createElement('div');
    toast.className = 'toast water-toast';
    toast.innerHTML = '<span>💧 Čas na vodu! Zbývá <strong>' + remaining + ' ml</strong> do cíle.</span>'
      + '<div class="water-toast-actions">'
      + '<button class="toast-undo" type="button">+250 ml</button>'
      + '<button class="toast-later" type="button">Později</button>'
      + '</div>';
    container.appendChild(toast);
    toast.querySelector('.toast-undo').onclick = function () { addWater(250); toast.remove(); waterReminderToastOpen = false; };
    toast.querySelector('.toast-later').onclick = function () {
      var s = getWaterSettings(); s.lastReminderAt = Date.now() - (s.intervalMinutes - 15) * 60 * 1000; saveWaterSettings(s);
      toast.remove(); waterReminderToastOpen = false;
    };
    setTimeout(function () { if (toast.parentNode) toast.remove(); waterReminderToastOpen = false; }, 14000);
  }
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Čas na vodu 💧', {
      body: 'Dopřej si sklenici vody. Do denního cíle zbývá ' + remaining + ' ml.',
      icon: '/logo.svg', badge: '/logo.svg', tag: 'water-reminder', renotify: true
    });
  }
}

// ── Favorites ─────────────────────────────────────────
async function loadFavorites(force) {
  var cached = !force ? cacheGet('favorites') : null;
  if (cached) { applyFavoritesCache(cached); return cached; }
  var data = await api('favorites');
  if (!data || !data.favorites) return [];
  cacheSet('favorites', data.favorites, 5 * 60 * 1000);
  applyFavoritesCache(data.favorites);
  return data.favorites;
}
function applyFavoritesCache(favorites) {
  favoritesCache = {};
  (favorites || []).forEach(function (f) {
    favoritesCache[String(f.product_id)] = f;
  });
}

function isFavoriteProduct(productId) {
  return !!favoritesCache[String(productId)];
}
async function addFavorite(productId) {
  var pid = String(productId); // UUID musí být string, ne parseInt
  var data = await api('favorites', { method: 'POST', body: JSON.stringify({ product_id: pid }) });
  if (data && data.ok) {
    cacheRemove('favorites');
    await loadFavorites(true);
    showToast('⭐ Přidáno do oblíbených');
    renderFavoriteProducts();
  } else if (data && data.error === 'Already in favorites') {
    showToast('Už je v oblíbených');
  } else {
    showToast('❌ Nepodařilo se přidat');
  }
}


async function removeFavorite(productId) {
  var pid = String(productId);
  var data = await api('favorites', { method: 'DELETE', body: JSON.stringify({ product_id: pid }) });
  if (data && data.ok) {
    cacheRemove('favorites');
    await loadFavorites(true);
    showToast('Odebráno z oblíbených');
    renderFavoriteProducts();
  } else {
    showToast('❌ Nepodařilo se odebrat');
  }
}

async function toggleFavorite(productId) {
  var pid = String(productId);
  if (isFavoriteProduct(pid)) {
    await removeFavorite(pid);
  } else {
    await addFavorite(pid);
  }
  document.querySelectorAll('.fav-btn').forEach(function (btn) {
    var p = String(btn.getAttribute('data-pid'));
    btn.textContent = isFavoriteProduct(p) ? '⭐' : '☆';
  });
  renderFavoriteProducts();
}

function renderFavoriteProducts() {
  var box = document.getElementById('favorite-products');
  if (!box) return;
  var favs = Object.values(favoritesCache || {});
  if (!favs.length) { box.innerHTML = '<div class="empty"><div class="empty-icon">⭐</div>Zatím žádná oblíbená jídla</div>'; return; }
  var html = '';
  favs.forEach(function (f) {
    var p = f.products; if (!p) return;
    html += '<div class="favorite-item"><div class="favorite-info"><div class="favorite-name">' + escapeHtml(p.name) + '</div>'
      + '<div class="favorite-meta">' + (p.calories != null ? p.calories : '?') + ' kcal/100g</div></div>'
      + '<div class="favorite-actions"><input type="number" class="favorite-grams" data-pid="' + p.id + '" value="100" min="1"/>'
      + '<button class="btn btn-primary btn-sm" onclick="addFavoriteMeal(' + p.id + ')">Přidat</button>'
      + '<button class="btn btn-icon" onclick="removeFavorite(' + p.id + ')" title="Odebrat">✕</button></div></div>';
  });
  box.innerHTML = html;
}
async function addFavoriteMeal(productId) {
  var pid = String(productId);
  var inp = document.querySelector('.favorite-grams[data-pid="' + pid + '"]');
  var grams = parseInt(inp ? inp.value : 100) || 100;
  var favorite = favoritesCache[pid];
  if (favorite && favorite.products) productsCache[pid] = favorite.products;
  await addMeal(pid, grams);
}


// ── Search + Add Meal ─────────────────────────────────
async function searchFood() {
  var q = (document.getElementById('search-input') ? document.getElementById('search-input').value : '').trim();
  if (!q) return;

  // Auto-detect barcode (8–14 číslic)
  if (/^\d{8,14}$/.test(q)) { await handleScannedBarcode(q); return; }

  var results = document.getElementById('search-results');
  if (!results) return;
  results.innerHTML = '<div class="loading-text">Hledám...</div>';
  var data = await api('products?q=' + encodeURIComponent(q));
  if (!data || !data.length) { results.innerHTML = '<div class="loading-text">Nic nenalezeno</div>'; return; }
  productsCache = {};
  data.forEach(function (p) { productsCache[p.id] = p; });
  var html = '';
  data.forEach(function (p) {
    var imgHtml = p.image_url ? '<img class="product-img" src="' + p.image_url + '" alt="">' : '<div class="product-img-placeholder">🥫</div>';
    var macros = p.calories + ' kcal/100g · B' + (p.protein_g != null ? p.protein_g : '?') + 'g T' + (p.fat_g != null ? p.fat_g : '?') + 'g S' + (p.carbs_g != null ? p.carbs_g : '?') + 'g';
    html += '<div class="product-result">' + imgHtml
      + '<div class="product-info"><div class="product-name">' + escapeHtml(p.name) + '</div><div class="product-kcal">' + macros + '</div></div>'
      + '<div class="product-add">'
      + '<button class="btn btn-icon fav-btn" data-pid="' + p.id + '" title="Oblíbené">' + (isFavoriteProduct(p.id) ? '⭐' : '☆') + '</button>'
      + '<input type="number" class="grams-input" data-pid="' + p.id + '" value="100" min="1" style="width:60px"/>'
      + '<button class="btn btn-primary btn-sm add-btn" data-pid="' + p.id + '">+</button>'
      + '</div></div>';
  });
  results.innerHTML = html;
  results.querySelectorAll('.add-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var pid = btn.getAttribute('data-pid');
      var inp = results.querySelector('.grams-input[data-pid="' + pid + '"]');
      addMeal(pid, parseInt(inp ? inp.value : 100) || 100);
    });
  });
  results.querySelectorAll('.fav-btn').forEach(function (btn) {
    btn.addEventListener('click', function () { toggleFavorite(String(btn.getAttribute('data-pid'))); });
  });
}

async function addMeal(pid, grams) {
  var p = productsCache[pid];
  await api('meals', { method: 'POST', body: JSON.stringify({ product_id: pid, weight_g: grams, meal_type: 'snack' }) });
  showToast('✓ ' + (p ? p.name : 'produkt') + ' přidáno');
  await loadMeals();
}

async function deleteMeal(id) {
  var saved = mealsCache[id] ? JSON.parse(JSON.stringify(mealsCache[id])) : null;
  var savedName = saved && saved.products ? saved.products.name : 'jídlo';
  var el = document.getElementById('meal-' + id);
  if (el) {
    el.style.transition = 'all 0.3s ease'; el.style.opacity = '0'; el.style.maxHeight = el.offsetHeight + 'px';
    setTimeout(function () { el.style.maxHeight = '0'; el.style.padding = '0'; el.style.margin = '0'; el.style.overflow = 'hidden'; }, 150);
  }
  await new Promise(function (r) { setTimeout(r, 300); });
  await api('meals', { method: 'DELETE', body: JSON.stringify({ meal_id: id }) });
  await loadMeals();
  addStatusLog('info', 'Jídlo smazáno: ' + savedName);
  showToast('Smazáno: ' + savedName, async function () {
    if (saved && saved.product_id && saved.weight_g) {
      await api('meals', { method: 'POST', body: JSON.stringify({ product_id: saved.product_id, weight_g: saved.weight_g, meal_type: saved.meal_type || 'snack' }) });
      await loadMeals(); showToast('✓ Obnoveno');
    }
  });
}

// ── Stats ─────────────────────────────────────────────
var statsDays = 7;
async function renderStats() {
  var app = document.getElementById('app');
  app.innerHTML = renderTopbar('Statistiky')
    + '<div class="page">'
    + '<div class="stats-toggle">'
    + '<button class="btn ' + (statsDays === 7 ? 'btn-primary' : 'btn-ghost') + '" onclick="loadStats(7)">7 dní</button>'
    + '<button class="btn ' + (statsDays === 30 ? 'btn-primary' : 'btn-ghost') + '" onclick="loadStats(30)">30 dní</button>'
    + '</div>'
    + '<div class="section-card"><div class="section-title">Kalorický přehled</div><div class="days-scroll" id="days-scroll"><div class="spinner"></div></div></div>'
    + '<div class="section-card" id="day-detail"><div class="empty"><div class="empty-icon">👆</div>Klikni na den pro detail</div></div>'
    + '</div>' + renderNav('stats');
  await loadStats(statsDays);
  setTimeout(function () { enableDragScroll(document.getElementById('days-scroll')); }, 100);
}

async function loadStats(days) {
  statsDays = days;
  document.querySelectorAll('.stats-toggle .btn').forEach(function (btn, i) {
    btn.className = 'btn ' + (statsDays === (i === 0 ? 7 : 30) ? 'btn-primary' : 'btn-ghost');
  });
  var data = await api('stats?days=' + days);
  var container = document.getElementById('days-scroll');
  if (!container) return;
  if (!data || !data.days || !Object.keys(data.days).length) { container.innerHTML = '<div class="loading-text">Žádná data</div>'; return; }
  var goal = cachedMacroGoals.calories;
  var dayNames = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
  var localDaysCache = {}, allDays = [];
  for (var i = days - 1; i >= 0; i--) {
    var d = new Date(); d.setDate(d.getDate() - i);
    var key = d.toISOString().split('T')[0];
    allDays.push({ key: key, d: new Date(d), dd: data.days[key] || null });
  }
  var html = '';
  allDays.forEach(function (item) {
    if (item.dd) localDaysCache[item.key] = item.dd;
    var kcal = item.dd ? Math.round(item.dd.calories) : 0;
    var pct = Math.min(kcal / goal, 1), r = 22, circ = 2 * Math.PI * r, dash = pct * circ;
    var color = !item.dd ? '#ddd' : pct < 0.7 ? '#1565c0' : pct < 1.1 ? '#43a047' : '#d32f2f';
    var isToday = item.d.toDateString() === new Date().toDateString();
    html += '<div class="day-pill" data-key="' + item.key + '">'
      + '<div class="day-label">' + (isToday ? 'Dnes' : dayNames[item.d.getDay()]) + '</div>'
      + '<div class="day-circle-wrap"><svg width="54" height="54" viewBox="0 0 54 54">'
      + '<circle cx="27" cy="27" r="' + r + '" fill="none" stroke="#eee" stroke-width="4"/>'
      + '<circle cx="27" cy="27" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="4" stroke-dasharray="' + dash + ' ' + circ + '" stroke-linecap="round"/>'
      + '</svg><div class="day-circle-inner"><span class="day-kcal">' + (kcal || '—') + '</span><span class="day-kcal-lbl">kcal</span></div></div>'
      + '<div class="day-date">' + item.d.getDate() + '.' + (item.d.getMonth() + 1) + '</div></div>';
  });
  container.innerHTML = html;
  setTimeout(function () { enableDragScroll(document.getElementById('days-scroll')); }, 100);
  container.querySelectorAll('.day-pill').forEach(function (pill) {
    pill.addEventListener('click', function () {
      var key = pill.getAttribute('data-key'), dd = localDaysCache[key], detail = document.getElementById('day-detail');
      if (!detail) return;
      if (!dd || !dd.calories) { detail.innerHTML = '<div class="empty"><div class="empty-icon">🍽️</div>Žádná data pro tento den</div>'; return; }
      var g = cachedMacroGoals, dObj = new Date(key);
      var fmt = dObj.getDate() + '. ' + (dObj.getMonth() + 1) + '. ' + dObj.getFullYear();
      detail.innerHTML = '<div class="section-title">' + fmt + '</div>'
        + barRow('Kalorie', 'dc-cal', '#f57c00') + barRow('Bílkoviny', 'dc-pro', '#1565c0')
        + barRow('Sacharidy', 'dc-carb', '#43a047') + barRow('Tuky', 'dc-fat', '#6a1b9a');
      setBar('dc-cal', dd.calories || 0, g.calories, Math.round(dd.calories) + ' / ' + g.calories + ' kcal');
      setBar('dc-pro', dd.protein || 0, g.protein, Math.round(dd.protein) + ' / ' + g.protein + ' g');
      setBar('dc-carb', dd.carbs || 0, g.carbs, Math.round(dd.carbs) + ' / ' + g.carbs + ' g');
      setBar('dc-fat', dd.fat || 0, g.fat, Math.round(dd.fat) + ' / ' + g.fat + ' g');
    });
  });
}

// ── Profile ───────────────────────────────────────────
var profileGoal = 'fit';
async function renderProfile() {
  var app = document.getElementById('app');
  app.innerHTML = renderTopbar('Profil') + '<div class="page"><div class="section-card" id="profile-content"><div class="spinner"></div></div></div>' + renderNav('profile');
  var p = await api('profile'); cachedProfile = p;
  var user = getUser(), goals = p ? calcMacroGoals(p) : cachedMacroGoals;
  profileGoal = (p && p.goal) ? p.goal : 'fit';
  var initials = user && user.name ? user.name[0].toUpperCase() : '?';
  var goalLabels = { lose: 'Zhubnout', muscle: 'Nabrat svaly', fit: 'Být fit' };
  var actLabels = { sedentary: 'Sedavý', light: 'Lehce aktivní', moderate: 'Středně aktivní', active: 'Velmi aktivní' };
  var act = (p && p.activity) ? p.activity : 'light';
  var goalTabsHtml = '<div class="goal-tabs" id="p-goal-tabs">';
  ['lose', 'muscle', 'fit'].forEach(function (g) { goalTabsHtml += '<button data-val="' + g + '" class="' + (profileGoal === g ? 'active' : '') + '">' + goalLabels[g] + '</button>'; });
  goalTabsHtml += '</div>';
  var actOptions = ['sedentary', 'light', 'moderate', 'active'].map(function (v) {
    return '<option value="' + v + '"' + (act === v ? ' selected' : '') + '>' + actLabels[v] + '</option>';
  }).join('');
  document.getElementById('profile-content').innerHTML =
    '<div class="profile-header"><div class="profile-avatar">' + initials + '</div>'
    + '<div><div class="profile-name">' + (user ? user.name : '') + '</div><div class="profile-email">' + (user ? user.email : '') + '</div></div></div>'
    + '<div class="tdee-box"><div><div class="tdee-label">Doporučený denní příjem</div>'
    + '<div class="tdee-value">' + goals.calories + ' kcal</div>'
    + '<div class="tdee-sub">' + goalLabels[profileGoal] + ' · ' + actLabels[act] + '</div></div><div style="font-size:40px">🎯</div></div>'
    + '<div class="macro-grid" style="margin-bottom:20px">'
    + macroBox('protein', goals.protein, 'g', 'Bílkoviny', 'pm-protein') + macroBox('carbs', goals.carbs, 'g', 'Sacharidy', 'pm-carbs')
    + macroBox('fat', goals.fat, 'g', 'Tuky', 'pm-fat') + macroBox('kcal', goals.calories, 'kcal', 'Energie', 'pm-kcal')
    + '</div><div class="divider"></div>'
    + '<div class="section-title" style="margin-bottom:16px">Upravit profil</div>'
    + '<div class="field"><label>Cíl</label>' + goalTabsHtml + '</div>'
    + '<div class="profile-slider-wrap"><div class="profile-slider-head"><span>Hmotnost</span><span id="lbl-weight">' + ((p && p.weight_kg) ? p.weight_kg : 70) + ' kg</span></div><input type="range" id="sl-weight" min="40" max="200" value="' + ((p && p.weight_kg) ? p.weight_kg : 70) + '"/></div>'
    + '<div class="profile-slider-wrap"><div class="profile-slider-head"><span>Výška</span><span id="lbl-height">' + ((p && p.height_cm) ? p.height_cm : 170) + ' cm</span></div><input type="range" id="sl-height" min="140" max="220" value="' + ((p && p.height_cm) ? p.height_cm : 170) + '"/></div>'
    + '<div class="profile-slider-wrap"><div class="profile-slider-head"><span>Cílová hmotnost</span><span id="lbl-gw">' + ((p && p.goal_weight_kg) ? p.goal_weight_kg : 65) + ' kg</span></div><input type="range" id="sl-gw" min="40" max="200" value="' + ((p && p.goal_weight_kg) ? p.goal_weight_kg : 65) + '"/></div>'
    + '<div class="field" style="margin-top:8px"><label>Aktivita</label><select id="p-activity">' + actOptions + '</select></div>'
    + '<button class="btn btn-primary" style="margin-top:8px" onclick="saveProfile()">Uložit změny</button>';
  document.getElementById('sl-weight').addEventListener('input', function () { document.getElementById('lbl-weight').textContent = this.value + ' kg'; });
  document.getElementById('sl-height').addEventListener('input', function () { document.getElementById('lbl-height').textContent = this.value + ' cm'; });
  document.getElementById('sl-gw').addEventListener('input', function () { document.getElementById('lbl-gw').textContent = this.value + ' kg'; });
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
  if (data) { cachedProfile = data; cachedMacroGoals = calcMacroGoals(data); showToast('✓ Profil uložen'); renderProfile(); }
  else showToast('❌ Chyba ukládání');
}

// ── Scanner ───────────────────────────────────────────
var _html5QrScanner = null;

function openScanner() {
  if (document.getElementById('scanner-modal')) return;
  var modal = document.createElement('div');
  modal.id = 'scanner-modal';
  modal.innerHTML = '<div class="scan-box"><div class="scan-title">📷 Naskenuj čárový kód</div>'
    + '<div id="qr-reader"></div>'
    + '<div class="scan-hint">Namiř kameru na čárový kód produktu (EAN-13 / EAN-8 / UPC)</div>'
    + '<button class="btn btn-ghost btn-sm" style="width:100%" onclick="closeScanner()">✕ Zrušit</button></div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeScanner(); });
  try {
    _html5QrScanner = new Html5Qrcode('qr-reader');
    _html5QrScanner.start(
      { facingMode: 'environment' },
      {
        fps: 10, qrbox: { width: 260, height: 120 },
        formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8, Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_E, Html5QrcodeSupportedFormats.CODE_128]
      },
      function (decodedText) { closeScanner(); handleScannedBarcode(decodedText); },
      function () { }
    ).catch(function (err) { console.error('Camera start error:', err); closeScanner(); showToast('❌ Nelze spustit kameru — zkontrolujte oprávnění'); });
  } catch (err) { console.error('Html5Qrcode init error:', err); closeScanner(); showToast('❌ Scanner není k dispozici'); }
}

function closeScanner() {
  if (_html5QrScanner) { _html5QrScanner.stop().catch(function () { }).finally(function () { _html5QrScanner = null; }); }
  var modal = document.getElementById('scanner-modal'); if (modal) modal.remove();
}

async function handleScannedBarcode(barcode) {
  var input = document.getElementById('search-input'); if (input) input.value = '';
  var results = document.getElementById('search-results'); if (!results) return;
  results.innerHTML = '<div class="barcode-badge">🔖 ' + barcode + '</div><div class="loading-text">Hledám produkt...</div>';
  var data = await api('products?barcode=' + encodeURIComponent(barcode));
  if (!data || !data.length) {
    results.innerHTML = '<div class="barcode-badge">🔖 ' + barcode + '</div><div class="loading-text">Produkt nenalezen — zkuste textové vyhledávání nebo ➕ ruční zadání</div>'; return;
  }
  productsCache = {};
  data.forEach(function (p) { productsCache[p.id] = p; });
  var html = '<div class="barcode-badge">🔖 ' + barcode + '</div>';
  data.forEach(function (p) {
    var imgHtml = p.image_url ? '<img class="product-img" src="' + p.image_url + '" alt="">' : '<div class="product-img-placeholder">🥫</div>';
    var macros = p.calories + ' kcal/100g · B' + (p.protein_g != null ? p.protein_g : '?') + 'g T' + (p.fat_g != null ? p.fat_g : '?') + 'g S' + (p.carbs_g != null ? p.carbs_g : '?') + 'g';
    html += '<div class="product-result">' + imgHtml + '<div class="product-info"><div class="product-name">' + p.name + '</div><div class="product-kcal">' + macros + '</div></div>'
      + '<div class="product-add"><input type="number" class="grams-input" data-pid="' + p.id + '" value="100" min="1" style="width:60px"/>'
      + '<button class="btn btn-primary btn-sm add-btn" data-pid="' + p.id + '">+</button></div></div>';
  });
  results.innerHTML = html;
  results.querySelectorAll('.add-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var pid = btn.getAttribute('data-pid');
      var inp = results.querySelector('.grams-input[data-pid="' + pid + '"]');
      addMeal(pid, parseInt(inp ? inp.value : 100) || 100);
    });
  });
}

function scanForManual() {
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
      var field = document.getElementById('mm-barcode');
      if (field) { field.value = code; showToast('✓ Kód naskenován: ' + code); }
    },
    function () { }
  );
}

// ── Manual product modal ──────────────────────────────
var manualTab = 'manual';
var _parsedNutrition = {};

function openManualProduct() {
  if (document.getElementById('manual-modal')) return;
  var modal = document.createElement('div');
  modal.id = 'manual-modal';
  modal.innerHTML = buildManualModal();
  document.body.appendChild(modal);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeManualModal(); });
  modal.querySelectorAll('.mm-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      manualTab = btn.dataset.tab;
      modal.querySelectorAll('.mm-tab').forEach(function (b) { b.classList.remove('active'); });
      modal.querySelectorAll('.mm-pane').forEach(function (p) { p.classList.remove('active'); });
      btn.classList.add('active');
      modal.querySelector('.mm-pane[data-pane="' + manualTab + '"]').classList.add('active');
    });
  });
}
function closeManualModal() { var m = document.getElementById('manual-modal'); if (m) m.remove(); }

function buildManualModal() {
  return '<div class="mm-box"><div class="mm-handle"></div><div class="mm-title">➕ Přidat vlastní produkt</div>'
    + '<div class="mm-tabs">'
    + '<button class="mm-tab' + (manualTab === 'manual' ? ' active' : '') + '" data-tab="manual">✏️ Ručně</button>'
    + '<button class="mm-tab' + (manualTab === 'paste' ? ' active' : '') + '" data-tab="paste">📋 Vložit text</button>'
    + '</div>'
    // Ručně
    + '<div class="mm-pane' + (manualTab === 'manual' ? ' active' : '') + '" data-pane="manual">'
    + '<div class="field"><label>Název produktu</label><input type="text" id="mm-name" placeholder="např. Jogurt jahoda Tesco"></div>'
    + '<div class="field"><label>Čárový kód (EAN) — nepovinné</label>'
    + '<div style="display:flex;gap:6px"><input type="text" id="mm-barcode" inputmode="numeric" placeholder="8594000205137" style="flex:1;font-family:\'DM Mono\',monospace"/>'
    + '<button class="scan-btn" style="padding:10px 12px" onclick="scanForManual()" title="Skenovat">📷</button></div>'
    + '<div style="font-size:11px;color:var(--text-3);margin-top:3px">Po uložení bude dohledatelný i skenem</div></div>'
    + '<div class="field" style="margin-bottom:6px"><label>Hodnoty na 100 g</label></div>'
    + '<div class="mm-grid">'
    + mmField('mm-cal', 'Kalorie kcal', '0') + mmField('mm-prot', 'Bílkoviny g', '0') + mmField('mm-fat', 'Tuky g', '0')
    + mmField('mm-carb', 'Sacharidy g', '0') + mmField('mm-fib', 'Vláknina g', '0') + mmField('mm-salt', 'Sůl g', '0')
    + '</div>'
    + '<div class="field"><label>Gramáž porce (g)</label><input type="number" id="mm-grams" value="100" min="1"></div>'
    + '<button class="btn btn-primary" onclick="saveManualProduct()">✓ Přidat do deníku</button>'
    + '</div>'
    // Vložit text
    + '<div class="mm-pane' + (manualTab === 'paste' ? ' active' : '') + '" data-pane="paste">'
    + '<div class="parse-hint">Vyfoť etiketu přes <strong>Google Lens</strong> nebo <strong>Google Překladač</strong>, zkopíruj text a vlož sem:</div>'
    + '<textarea class="paste-area" id="mm-paste-text" placeholder="Energie 1467 kJ / 350 kcal&#10;Bílkoviny 12,5 g&#10;Tuky 8,3 g&#10;Sacharidy 45,2 g&#10;Vláknina 2,1 g&#10;Sůl 0,8 g"></textarea>'
    + '<button class="btn btn-ghost btn-sm" style="width:100%;margin-bottom:10px" onclick="parseAndPreview()">🔍 Rozpoznat hodnoty</button>'
    + '<div id="mm-parse-preview" style="display:none"></div>'
    + '<div class="field"><label>Název produktu</label><input type="text" id="mm-paste-name" placeholder="Zadej název ručně"></div>'
    + '<div class="field"><label>Čárový kód (EAN) — nepovinné</label>'
    + '<div style="display:flex;gap:6px"><input type="text" id="mm-paste-barcode" inputmode="numeric" placeholder="8594000205137" style="flex:1;font-family:\'DM Mono\',monospace"/>'
    + '<button class="scan-btn" style="padding:10px 12px" onclick="scanForManual()" title="Skenovat">📷</button></div></div>'
    + '<div class="field"><label>Gramáž porce (g)</label><input type="number" id="mm-paste-grams" value="100" min="1"></div>'
    + '<button class="btn btn-primary" onclick="savePastedProduct()">✓ Přidat do deníku</button>'
    + '</div></div>';
}

function mmField(id, label, placeholder) {
  return '<div class="field"><label>' + label + '</label><input type="number" id="' + id + '" placeholder="' + placeholder + '" min="0" step="0.1"></div>';
}

function parseNutritionText(raw) {
  var t = raw.replace(/,/g, '.').replace(/\u00a0/g, ' ');
  function extract(pats) {
    for (var i = 0; i < pats.length; i++) { var m = t.match(pats[i]); if (m) { var v = parseFloat(m[1]); if (!isNaN(v)) return v; } } return null;
  }
  var kcalLine = t.match(/(\d+(?:\.\d+)?)\s*kcal/i);
  var calories = kcalLine ? parseFloat(kcalLine[1]) : null;
  if (!calories) { var kjLine = t.match(/(\d+(?:\.\d+)?)\s*kj/i); if (kjLine) calories = Math.round(parseFloat(kjLine[1]) / 4.184); }
  var protein = extract([/b[ií]lkovin[ay]?\s+(\d+(?:\.\d+)?)/i, /protein[s]?\s*[:\/]?\s*(\d+(?:\.\d+)?)/i]);
  var fat = extract([/tuk[yů]?\s+(\d+(?:\.\d+)?)/i, /fat\s*[:\/]?\s*(\d+(?:\.\d+)?)/i]);
  var carbs = extract([/sacharid[yů]?\s+(\d+(?:\.\d+)?)/i, /carbohydrate[s]?\s*[:\/]?\s*(\d+(?:\.\d+)?)/i]);
  var fiber = extract([/vl[aá]knin[ay]?\s+(\d+(?:\.\d+)?)/i, /fiber\s*[:\/]?\s*(\d+(?:\.\d+)?)/i, /fibre\s*[:\/]?\s*(\d+(?:\.\d+)?)/i]);
  var salt = extract([/s[uů]l\s+(\d+(?:\.\d+)?)/i, /salt\s*[:\/]?\s*(\d+(?:\.\d+)?)/i, /sodium\s*[:\/]?\s*(\d+(?:\.\d+)?)/i]);
  if (salt && t.match(/sodium/i) && !t.match(/s[uů]l/i)) salt = Math.round(salt * 2.5 * 10) / 10;
  return { calories: calories, protein: protein, fat: fat, carbs: carbs, fiber: fiber, salt: salt };
}

function parseAndPreview() {
  var raw = document.getElementById('mm-paste-text') ? document.getElementById('mm-paste-text').value : '';
  if (!raw.trim()) { showToast('⚠ Vložte text z etikety'); return; }
  _parsedNutrition = parseNutritionText(raw);
  var prev = document.getElementById('mm-parse-preview'); if (!prev) return;
  var rows = [['Kalorie', _parsedNutrition.calories, 'kcal'], ['Bílkoviny', _parsedNutrition.protein, 'g'], ['Tuky', _parsedNutrition.fat, 'g'], ['Sacharidy', _parsedNutrition.carbs, 'g'], ['Vláknina', _parsedNutrition.fiber, 'g'], ['Sůl', _parsedNutrition.salt, 'g']];
  var html = '<div class="parse-preview"><strong>Rozpoznané hodnoty na 100 g:</strong><br><br>';
  rows.forEach(function (r) { html += '<div class="parse-row"><span>' + r[0] + '</span><span>' + (r[1] != null ? r[1] + ' ' + r[2] : '—') + '</span></div>'; });
  prev.style.display = 'block'; prev.innerHTML = html + '</div>';
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
  var barcode = document.getElementById('mm-barcode') ? (document.getElementById('mm-barcode').value.trim() || null) : null;
  if (!name) { showToast('⚠ Zadejte název produktu'); return; }
  if (!cal) { showToast('⚠ Zadejte kalorie'); return; }
  await addCustomProduct({ name: name, cal: cal, prot: prot, fat: fat, carb: carb, fib: fib, salt: salt, grams: grams, barcode: barcode });
}

async function savePastedProduct() {
  var name = document.getElementById('mm-paste-name') ? document.getElementById('mm-paste-name').value.trim() : '';
  var grams = parseInt(document.getElementById('mm-paste-grams') ? document.getElementById('mm-paste-grams').value : '100') || 100;
  var barcode = document.getElementById('mm-paste-barcode') ? (document.getElementById('mm-paste-barcode').value.trim() || null) : null;
  if (!name) { showToast('⚠ Zadejte název produktu'); return; }
  if (!_parsedNutrition.calories) { showToast('⚠ Nejprve klikněte Rozpoznat hodnoty'); return; }
  await addCustomProduct({ name: name, cal: _parsedNutrition.calories, prot: _parsedNutrition.protein, fat: _parsedNutrition.fat, carb: _parsedNutrition.carbs, fib: _parsedNutrition.fiber, salt: _parsedNutrition.salt, grams: grams, barcode: barcode });
}

async function addCustomProduct(o) {
  var saved = await api('products/manual', {
    method: 'POST',
    body: JSON.stringify({
      name: o.name, calories: o.cal, protein_g: o.prot, fat_g: o.fat,
      carbs_g: o.carb, fiber_g: o.fib, salt_g: o.salt,
      barcode: o.barcode || null,   // ✅ FIX: barcode se skutečně odesílá
      source: 'manual'
    })
  });
  if (!saved || !saved.id) { showToast('❌ Nepodařilo se uložit produkt'); return; }
  await api('meals', { method: 'POST', body: JSON.stringify({ product_id: saved.id, weight_g: o.grams, meal_type: 'snack' }) });
  closeManualModal();
  showToast('✓ ' + o.name + ' přidáno');
  await loadMeals();
}

// ── Utils ─────────────────────────────────────────────
applyTheme();

function enableDragScroll(el) {
  if (!el) return;
  var isDown = false, startX, scrollLeft;
  el.addEventListener('mousedown', function (e) { isDown = true; el.style.cursor = 'grabbing'; startX = e.pageX - el.offsetLeft; scrollLeft = el.scrollLeft; });
  el.addEventListener('mouseleave', function () { isDown = false; el.style.cursor = 'grab'; });
  el.addEventListener('mouseup', function () { isDown = false; el.style.cursor = 'grab'; });
  el.addEventListener('mousemove', function (e) { if (!isDown) return; e.preventDefault(); el.scrollLeft = scrollLeft - (e.pageX - el.offsetLeft - startX); });
  el.style.cursor = 'grab';
  el.addEventListener('wheel', function (e) { if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) { e.preventDefault(); el.scrollLeft += e.deltaY; } }, { passive: false });
}

// ── Dark theme on login/register ─────────────────────
var _origRenderLogin = renderLogin;
renderLogin = function () {
  _origRenderLogin();
  var btn = document.createElement('button');
  btn.className = 'dark-float-btn'; btn.textContent = darkMode ? '☀️' : '🌙';
  btn.onclick = function () { darkMode = !darkMode; localStorage.setItem('cv_dark', darkMode ? '1' : '0'); applyTheme(); btn.textContent = darkMode ? '☀️' : '🌙'; };
  document.getElementById('app').appendChild(btn);
};
var _origRenderRegPage = renderRegisterPage;
renderRegisterPage = function (step) {
  _origRenderRegPage(step);
  var btn = document.createElement('button');
  btn.className = 'dark-float-btn'; btn.textContent = darkMode ? '☀️' : '🌙';
  btn.onclick = function () { darkMode = !darkMode; localStorage.setItem('cv_dark', darkMode ? '1' : '0'); applyTheme(); btn.textContent = darkMode ? '☀️' : '🌙'; };
  document.getElementById('app').appendChild(btn);
};


router();
startWaterReminderLoop();
// Registrace Service Workera pro PWA instalaci
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(console.error);
}
