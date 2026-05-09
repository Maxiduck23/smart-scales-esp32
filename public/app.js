// CHYTRÁ VÁHA — app.js (clean rewrite)

// ── Auth ──────────────────────────────────────────────
function getToken() { return localStorage.getItem('cv_token'); }
function saveToken(t) { localStorage.setItem('cv_token', t); }
function getUser() { try { return JSON.parse(localStorage.getItem('cv_user') || 'null'); } catch (e) { return null; } }
function saveUser(u) { localStorage.setItem('cv_user', JSON.stringify(u)); }

function logout() {
  localStorage.removeItem('cv_token');
  localStorage.removeItem('cv_user');
  clearWeightInterval();
  router();
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
    if (res.status === 401) { logout(); return null; }
    return res.json();
  } catch (e) { console.error('API error:', e); return null; }
}

// ── State ─────────────────────────────────────────────
var currentPage = 'dashboard';
var weightIntervalId = null;
var searchTimer = null;
var cachedProfile = null;
var cachedMacroGoals = { calories: 2000, protein: 150, carbs: 250, fat: 65 };
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
    + '<div class="topbar-logo">⚖️ ' + title + '</div>'
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
    + '<div class="auth-logo">⚖️</div>'
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
  var data = await api('auth/login', { method: 'POST', body: JSON.stringify({ email: email, password: pass }) });
  if (data && data.token) {
    saveToken(data.token);
    saveUser({ name: data.name, email: email });
    router();
  } else {
    err.textContent = (data && data.error) ? data.error : 'Chyba přihlášení';
    err.style.display = 'block';
  }
}

// ═══════════════════════════════════════════════════════
//  REGISTER (2 steps)
// ═══════════════════════════════════════════════════════
var regData = {};

function renderRegisterPage(step) {
  step = step || 1;
  var html = '<div class="auth-wrap">'
    + '<div class="auth-logo">⚖️</div>'
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
  } else {
    err.textContent = (data && data.error) ? data.error : 'Chyba registrace';
    err.style.display = 'block';
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
    + '<input type="text" id="search-input" placeholder="Hledat potravinu..."/>'
    + '<button class="btn btn-primary btn-sm" onclick="searchFood()">Hledat</button>'
    + '</div>'
    + '<div id="search-results"></div>'
    + '</div>'
    // Meals
    + '<div class="section-card">'
    + '<div class="section-title"><span>Dnes jsem jedl</span><span id="total-kcal-badge" style="font-size:12px;color:var(--text-3);font-weight:400"></span></div>'
    + '<div id="meals-list"><div class="spinner"></div></div>'
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
//  SEARCH + ADD MEAL
// ═══════════════════════════════════════════════════════
async function searchFood() {
  var q = (document.getElementById('search-input') ? document.getElementById('search-input').value : '').trim();
  if (!q) return;
  var results = document.getElementById('search-results');
  if (!results) return;
  results.innerHTML = '<div class="loading-text">Hledám...</div>';
  var data = await api('products?q=' + encodeURIComponent(q));
  if (!data || !data.length) {
    results.innerHTML = '<div class="loading-text">Nic nenalezeno</div>';
    return;
  }

  productsCache = {};
  data.forEach(function (p) { productsCache[p.id] = p; });

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
}

var daysCache = {};

async function loadStats(days) {
  statsDays = days;
  document.querySelectorAll('.stats-toggle .btn').forEach(function (btn, i) {
    var d = i === 0 ? 7 : 30;
    btn.className = 'btn ' + (statsDays === d ? 'btn-primary' : 'btn-ghost');
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
  daysCache = {};

  var allDays = [];
  for (var i = days - 1; i >= 0; i--) {
    var d = new Date();
    d.setDate(d.getDate() - i);
    var key = d.toISOString().split('T')[0];
    allDays.push({ key: key, d: d, dd: data.days[key] || null });
  }

  var html = '';
  allDays.forEach(function (item) {
    var key = item.key;
    var d = item.d;
    var dd = item.dd;
    if (dd) daysCache[key] = dd;
    var kcal = dd ? Math.round(dd.calories) : 0;
    var pct = Math.min(kcal / goal, 1);
    var r = 22;
    var circ = 2 * Math.PI * r;
    var dash = pct * circ;
    var color = !dd ? '#ddd' : pct < 0.7 ? '#1565c0' : pct < 1.1 ? '#43a047' : '#d32f2f';
    var isToday = d.toDateString() === new Date().toDateString();
    var dayLbl = isToday ? 'Dnes' : dayNames[d.getDay()];
    html += '<div class="day-pill" data-key="' + key + '">'
      + '<div class="day-label">' + dayLbl + '</div>'
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
      + '<div class="day-date">' + d.getDate() + '.' + (d.getMonth() + 1) + '</div>'
      + '</div>';
  });
  container.innerHTML = html;

  container.querySelectorAll('.day-pill').forEach(function (pill) {
    pill.addEventListener('click', function () {
      showDayDetail(pill.getAttribute('data-key'));
    });
  });
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
router();