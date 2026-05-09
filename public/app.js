// ═══════════════════════════════════════════════════════
//  CHYTRÁ VÁHA — app.js
//  Pages: Login → Register (2 steps) → Dashboard
//         → Stats → Profile
// ═══════════════════════════════════════════════════════

// ── Auth helpers ──────────────────────────────────────
const getToken  = () => localStorage.getItem('cv_token');
const saveToken = t  => localStorage.setItem('cv_token', t);
const getUser   = () => { try { return JSON.parse(localStorage.getItem('cv_user') || 'null'); } catch { return null; } };
const saveUser  = u  => localStorage.setItem('cv_user', JSON.stringify(u));

function logout() {
  localStorage.removeItem('cv_token');
  localStorage.removeItem('cv_user');
  clearWeightInterval();
  router();
}

// ── API helper ────────────────────────────────────────
async function api(path, options = {}) {
  try {
    const res = await fetch(`/api/${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`,
        ...(options.headers || {})
      }
    });
    if (res.status === 401) { logout(); return null; }
    return res.json();
  } catch (e) {
    console.error('API error:', e);
    return null;
  }
}

// ── State ─────────────────────────────────────────────
let currentPage   = 'dashboard';
let weightIntervalId = null;
let searchTimer   = null;
let cachedProfile = null;
let cachedMacroGoals = { calories: 2000, protein: 150, carbs: 250, fat: 65 };
let mealsCache    = {};  // id → meal object, для undo

function clearWeightInterval() {
  if (weightIntervalId) { clearInterval(weightIntervalId); weightIntervalId = null; }
}

// ── Router ────────────────────────────────────────────
function router(page = 'dashboard') {
  clearWeightInterval();
  if (!getToken()) { renderLogin(); return; }
  currentPage = page;
  switch (page) {
    case 'dashboard': renderDashboard(); break;
    case 'stats':     renderStats();     break;
    case 'profile':   renderProfile();   break;
    default:          renderDashboard();
  }
}

// ═══════════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════════
function showToast(msg, undoFn = null, duration = 4000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>${msg}</span>`;
  if (undoFn) {
    const btn = document.createElement('button');
    btn.className = 'toast-undo';
    btn.textContent = 'Zpět';
    btn.onclick = () => { undoFn(); toast.remove(); };
    toast.appendChild(btn);
  }
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// ═══════════════════════════════════════════════════════
//  NAV
// ═══════════════════════════════════════════════════════
function renderNav(active) {
  const items = [
    { id: 'dashboard', icon: '🏠', label: 'Přehled' },
    { id: 'stats',     icon: '📅', label: 'Statistiky' },
    { id: 'profile',   icon: '👤', label: 'Profil' },
  ];
  return `
    <nav class="bottom-nav">
      ${items.map(i => `
        <button class="nav-item ${active === i.id ? 'active' : ''}" onclick="router('${i.id}')">
          <span class="nav-icon">${i.icon}</span>
          <span>${i.label}</span>
        </button>`).join('')}
    </nav>`;
}

function renderTopbar(title = 'Chytrá váha') {
  return `
    <div class="topbar">
      <div class="topbar-logo">⚖️ ${title}</div>
      <div class="topbar-actions">
        <button class="btn btn-ghost btn-sm" onclick="logout()">Odhlásit</button>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════
//  LOGIN
// ═══════════════════════════════════════════════════════
function renderLogin() {
  document.getElementById('app').innerHTML = `
    <div class="auth-wrap">
      <div class="auth-logo">⚖️</div>
      <div class="auth-title">Chytrá váha</div>
      <div class="auth-sub">Přihlaste se ke svému účtu</div>
      <div class="auth-card">
        <div class="err-msg" id="err"></div>
        <div class="field">
          <label>Email</label>
          <input type="email" id="email" placeholder="vas@email.cz" autocomplete="email"/>
        </div>
        <div class="field">
          <label>Heslo</label>
          <input type="password" id="password" placeholder="••••••••" autocomplete="current-password"
            onkeydown="if(event.key==='Enter') doLogin()"/>
        </div>
        <button class="btn btn-primary" onclick="doLogin()">Přihlásit se</button>
        <div class="auth-link">Nemáte účet? <a onclick="renderRegisterPage()">Registrovat se</a></div>
      </div>
    </div>`;
}

async function doLogin() {
  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const err      = document.getElementById('err');
  err.style.display = 'none';
  if (!email || !password) { showErr('Vyplňte email a heslo'); return; }
  const data = await api('auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (data?.token) {
    saveToken(data.token);
    saveUser({ name: data.name, email });
    router();
  } else {
    showErr(data?.error || 'Chyba přihlášení');
  }
  function showErr(msg) { err.textContent = msg; err.style.display = 'block'; }
}

// ═══════════════════════════════════════════════════════
//  REGISTER — 2 steps
// ═══════════════════════════════════════════════════════
let regData = {};

function renderRegisterPage(step = 1) {
  document.getElementById('app').innerHTML = `
    <div class="auth-wrap">
      <div class="auth-logo">⚖️</div>
      <div class="auth-title">Registrace</div>
      <div class="auth-sub">Krok ${step} ze 2</div>
      <div class="step-indicator">
        <div class="step-dot ${step >= 1 ? (step > 1 ? 'done' : 'active') : ''}"></div>
        <div class="step-dot ${step >= 2 ? 'active' : ''}"></div>
      </div>
      <div class="auth-card" id="reg-card">
        <div class="err-msg" id="err"></div>
        ${step === 1 ? renderRegStep1() : renderRegStep2()}
      </div>
      <div class="auth-link">Máte účet? <a onclick="renderLogin()">Přihlásit se</a></div>
    </div>`;
  if (step === 2) initGoalTabs();
}

function renderRegStep1() {
  return `
    <div class="field">
      <label>Jméno</label>
      <input type="text" id="name" placeholder="Vaše jméno" value="${regData.name || ''}"/>
    </div>
    <div class="field">
      <label>Email</label>
      <input type="email" id="email" placeholder="vas@email.cz" value="${regData.email || ''}"/>
    </div>
    <div class="field">
      <label>Heslo</label>
      <input type="password" id="password" placeholder="min. 6 znaků"/>
    </div>
    <button class="btn btn-primary" onclick="regStep1Next()">Pokračovat →</button>`;
}

function renderRegStep2() {
  return `
    <div class="field">
      <label>Cíl</label>
      <div class="goal-tabs" id="goal-tabs">
        <button data-val="lose" class="active">Zhubnout</button>
        <button data-val="muscle">Nabrat svaly</button>
        <button data-val="fit">Být fit</button>
      </div>
    </div>
    <div class="row-2">
      <div class="field">
        <label>Rok narození</label>
        <input type="number" id="birth_year" placeholder="2000" value="${regData.birth_year || ''}" min="1950" max="2010"/>
      </div>
      <div class="field">
        <label>Výška (cm)</label>
        <input type="number" id="height_cm" placeholder="170" value="${regData.height_cm || ''}"/>
      </div>
    </div>
    <div class="row-2">
      <div class="field">
        <label>Hmotnost (kg)</label>
        <input type="number" id="weight_kg" placeholder="70" value="${regData.weight_kg || ''}"/>
      </div>
      <div class="field">
        <label>Cíl. hmotnost (kg)</label>
        <input type="number" id="goal_weight_kg" placeholder="65" value="${regData.goal_weight_kg || ''}"/>
      </div>
    </div>
    <div class="field">
      <label>Aktivita</label>
      <select id="activity">
        <option value="sedentary"  ${regData.activity==='sedentary' ?'selected':''}>Sedavý</option>
        <option value="light"      ${regData.activity==='light'||!regData.activity?'selected':''}>Lehce aktivní</option>
        <option value="moderate"   ${regData.activity==='moderate'?'selected':''}>Středně aktivní</option>
        <option value="active"     ${regData.activity==='active'?'selected':''}>Velmi aktivní</option>
      </select>
    </div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" style="flex:1" onclick="renderRegisterPage(1)">← Zpět</button>
      <button class="btn btn-primary" style="flex:2" onclick="doRegister()">Vytvořit účet</button>
    </div>`;
}

function initGoalTabs() {
  regData.goal = regData.goal || 'lose';
  document.querySelectorAll('#goal-tabs button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === regData.goal);
    btn.onclick = () => {
      regData.goal = btn.dataset.val;
      document.querySelectorAll('#goal-tabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    };
  });
}

function regStep1Next() {
  const name     = document.getElementById('name').value.trim();
  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const err = document.getElementById('err');
  if (!name || !email || !password) { err.textContent = 'Vyplňte všechna pole'; err.style.display = 'block'; return; }
  if (password.length < 6) { err.textContent = 'Heslo musí mít alespoň 6 znaků'; err.style.display = 'block'; return; }
  regData = { ...regData, name, email, password };
  renderRegisterPage(2);
}

async function doRegister() {
  const birth_year    = parseInt(document.getElementById('birth_year').value) || null;
  const height_cm     = parseInt(document.getElementById('height_cm').value) || null;
  const weight_kg     = parseFloat(document.getElementById('weight_kg').value) || null;
  const goal_weight_kg = parseFloat(document.getElementById('goal_weight_kg').value) || null;
  const activity      = document.getElementById('activity').value;
  const goal          = regData.goal || 'lose';
  const err = document.getElementById('err');

  const payload = { ...regData, birth_year, height_cm, weight_kg, goal_weight_kg, goal, activity };
  delete payload.password; // will re-add
  payload.password = regData.password;

  const data = await api('auth/register', { method: 'POST', body: JSON.stringify(payload) });
  if (data?.token) {
    saveToken(data.token);
    saveUser({ name: data.name, email: regData.email });
    regData = {};
    router();
  } else {
    err.textContent = data?.error || 'Chyba registrace';
    err.style.display = 'block';
  }
}

// ═══════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════
async function renderDashboard() {
  const app = document.getElementById('app');
  app.innerHTML = renderTopbar() + `
    <div class="page" id="dash-page">
      <div class="weight-hero">
        <div class="weight-hero-label">Aktuální váha ze senzoru</div>
        <div class="weight-hero-value" id="w-val">--<span>g</span></div>
        <div class="weight-hero-status">
          <div class="status-dot" id="w-dot"></div>
          <span id="w-status">Čekám na váhu...</span>
        </div>
      </div>

      <div class="macro-grid" id="macro-grid">
        ${macroBox('kcal','--','kcal','Energie')}
        ${macroBox('protein','--','g','Bílkoviny')}
        ${macroBox('carbs','--','g','Sacharidy')}
        ${macroBox('fat','--','g','Tuky')}
      </div>

      <div class="section-card">
        <div class="section-title">Denní cíle</div>
        ${barRow('Kalorie','bar-cal','#f57c00')}
        ${barRow('Bílkoviny','bar-pro','#1565c0')}
        ${barRow('Sacharidy','bar-carb','#43a047')}
        ${barRow('Tuky','bar-fat','#6a1b9a')}
      </div>

      <div class="section-card">
        <div class="section-title">🔍 Přidat jídlo</div>
        <div class="search-wrap">
          <input type="text" id="search-input" placeholder="Hledat potravinu..." oninput="onSearchInput()"/>
          <button class="btn btn-primary btn-sm" onclick="searchFood()">Hledat</button>
        </div>
        <div id="search-results"></div>
      </div>

      <div class="section-card">
        <div class="section-title">
          <span>Dnes jsem jedl</span>
          <span id="total-kcal-badge" style="font-size:12px;color:var(--text-3);font-weight:400"></span>
        </div>
        <div id="meals-list"><div class="spinner"></div></div>
      </div>
    </div>
    ${renderNav('dashboard')}`;

  startWeightPolling();
  await loadMealsAndProfile();
}

function macroBox(cls, val, unit, lbl) {
  return `<div class="macro-box ${cls}">
    <div class="macro-val" id="mb-${cls}">${val}<small>${unit}</small></div>
    <div class="macro-lbl">${lbl}</div>
  </div>`;
}

function barRow(name, id, color) {
  return `<div class="bar-row">
    <div class="bar-head">
      <span class="bar-name">${name}</span>
      <span class="bar-nums" id="v-${id}">--</span>
    </div>
    <div class="bar-track">
      <div class="bar-fill" id="${id}" style="width:0%;background:${color}"></div>
    </div>
  </div>`;
}

// ── Weight polling ────────────────────────────────────
function startWeightPolling() {
  clearWeightInterval();
  weightIntervalId = setInterval(async () => {
    if (!document.getElementById('w-val')) { clearWeightInterval(); return; }
    const data = await api('weight');
    if (data?.grams != null) {
      document.getElementById('w-val').innerHTML = `${data.grams}<span>g</span>`;
      const dot = document.getElementById('w-dot');
      const st  = document.getElementById('w-status');
      if (dot) { dot.classList.add('active'); }
      if (st)  { st.textContent = '✓ Váha stabilizována'; }
    }
  }, 1000);
}

// ── Load meals + update UI ────────────────────────────
async function loadMealsAndProfile() {
  // Load profile for goals
  if (!cachedProfile) {
    cachedProfile = await api('profile');
    if (cachedProfile) {
      cachedMacroGoals = calcMacroGoals(cachedProfile);
    }
  }
  await loadMeals();
}

function calcMacroGoals(p) {
  if (!p?.birth_year || !p?.weight_kg || !p?.height_cm) return cachedMacroGoals;
  const age = new Date().getFullYear() - p.birth_year;
  const bmr = 10 * p.weight_kg + 6.25 * p.height_cm - 5 * age;
  const factors = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 };
  const tdee = bmr * (factors[p.activity] || 1.375);
  const adj  = { lose: -500, muscle: 300, fit: 0 };
  const cal  = Math.round(tdee + (adj[p.goal] || 0));
  const protMult = { lose: 1.6, muscle: 2.0, fit: 1.4 };
  const prot = Math.round(p.weight_kg * (protMult[p.goal] || 1.5));
  const fat  = Math.round(cal * 0.27 / 9);
  const carbs= Math.round((cal - prot * 4 - fat * 9) / 4);
  return { calories: cal, protein: prot, fat, carbs };
}

async function loadMeals() {
  const data = await api('meals');
  if (!data) return;
  const t = data.totals || {};
  const g = cachedMacroGoals;

  // Macro boxes
  setEl('mb-kcal',    `${Math.round(t.calories||0)}<small>kcal</small>`);
  setEl('mb-protein', `${Math.round(t.protein||0)}<small>g</small>`);
  setEl('mb-carbs',   `${Math.round(t.carbs||0)}<small>g</small>`);
  setEl('mb-fat',     `${Math.round(t.fat||0)}<small>g</small>`);

  // Bars
  setBar('bar-cal',  t.calories||0, g.calories, `${Math.round(t.calories||0)} / ${g.calories} kcal`, 'v-bar-cal');
  setBar('bar-pro',  t.protein||0,  g.protein,  `${Math.round(t.protein||0)} / ${g.protein} g`,     'v-bar-pro');
  setBar('bar-carb', t.carbs||0,    g.carbs,    `${Math.round(t.carbs||0)} / ${g.carbs} g`,         'v-bar-carb');
  setBar('bar-fat',  t.fat||0,      g.fat,      `${Math.round(t.fat||0)} / ${g.fat} g`,             'v-bar-fat');

  const badge = document.getElementById('total-kcal-badge');
  if (badge) badge.textContent = `${Math.round(t.calories||0)} kcal celkem`;

  // Meals list
  const list = document.getElementById('meals-list');
  if (!list) return;
  if (!data.meals?.length) {
    list.innerHTML = `<div class="empty"><div class="empty-icon">🍽️</div>Zatím nic přidáno</div>`;
    return;
  }
  mealsCache = {};
  list.innerHTML = data.meals.map(m => {
    mealsCache[m.id] = m;
    const kcal = Math.round((m.products?.calories || 0) * m.weight_g / 100);
    return `
      <div class="meal-item" id="meal-${m.id}">
        <div class="meal-dot"></div>
        <div class="meal-info">
          <div class="meal-name">${m.products?.name || '?'}</div>
          <div class="meal-meta">${m.weight_g} g · ${kcal} kcal</div>
        </div>
        <span class="meal-kcal">${kcal} kcal</span>
        <button class="btn btn-danger btn-sm" onclick="deleteMeal(${m.id})">✕</button>
      </div>`;
  }).join('');
}

function setEl(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function setBar(barId, val, goal, label, labelId) {
  const bar = document.getElementById(barId);
  const lbl = document.getElementById(labelId);
  if (bar) bar.style.width = Math.min(val / goal * 100, 100) + '%';
  if (lbl) lbl.textContent = label;
  // Also update the v- labels in bar rows
  const vEl = document.getElementById('v-' + barId);
  if (vEl) vEl.textContent = label;
}

// ═══════════════════════════════════════════════════════
//  SEARCH + ADD MEAL
// ═══════════════════════════════════════════════════════
function onSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchFood, 480);
}

async function searchFood() {
  const q = (document.getElementById('search-input')?.value || '').trim();
  if (!q) return;
  const results = document.getElementById('search-results');
  if (!results) return;
  results.innerHTML = '<div class="loading-text">Hledám...</div>';
  const data = await api(`products?q=${encodeURIComponent(q)}`);
  if (!data?.length) {
    results.innerHTML = '<div class="loading-text">Nic nenalezeno</div>';
    return;
  }
  results.innerHTML = data.map(p => {
    const key = (p.barcode || p.name || p.id).toString().replace(/[^a-z0-9]/gi, '_');
    return `
      <div class="product-result">
        ${p.image_url
          ? `<img class="product-img" src="${p.image_url}" alt="" onerror="this.style.display='none'">`
          : `<div class="product-img-placeholder">🥫</div>`}
        <div class="product-info">
          <div class="product-name">${p.name}</div>
          <div class="product-kcal">${p.calories} kcal / 100g · B${p.protein_g??'?'}g T${p.fat_g??'?'}g S${p.carbs_g??'?'}g</div>
        </div>
        <div class="product-add">
          <input type="number" id="g-${key}" value="100" min="1" style="width:60px"/>
          <button class="btn btn-primary btn-sm"
            onclick="addMeal('${p.id}','${p.barcode||''}','${p.name.replace(/'/g,'\\'')}','${key}')">+</button>
        </div>
      </div>`;
  }).join('');
}

async function addMeal(productId, barcode, name, key) {
  let id = productId;
  if (!id || id === 'null' || id === 'undefined') {
    const found = await api(`products?q=${encodeURIComponent(name)}`);
    const product = found?.find(p => p.barcode === barcode || p.name === name);
    id = product?.id;
  }
  if (!id) { showToast('❌ Produkt nenalezen'); return; }
  const gramsEl = document.getElementById(`g-${key}`);
  const grams = parseInt(gramsEl?.value || 100);
  await api('meals', { method: 'POST', body: JSON.stringify({ product_id: id, weight_g: grams, meal_type: 'snack' }) });
  showToast(`✓ ${name} přidáno`);
  await loadMeals();
}

async function deleteMeal(id) {
  const mealObj = mealsCache[id];
  // Optimistic remove
  const el = document.getElementById(`meal-${id}`);
  if (el) el.style.opacity = '0.3';

  await api('meals', { method: 'DELETE', body: JSON.stringify({ meal_id: id }) });
  await loadMeals();

  showToast(`Smazáno: ${mealObj?.products?.name || 'jídlo'}`, async () => {
    if (mealObj?.product_id && mealObj?.weight_g) {
      await api('meals', {
        method: 'POST',
        body: JSON.stringify({ product_id: mealObj.product_id, weight_g: mealObj.weight_g, meal_type: mealObj.meal_type || 'snack' })
      });
      await loadMeals();
      showToast('✓ Obnoveno');
    }
  });
}

// ═══════════════════════════════════════════════════════
//  STATS PAGE
// ═══════════════════════════════════════════════════════
let statsDays = 7;

async function renderStats() {
  const app = document.getElementById('app');
  app.innerHTML = renderTopbar('Statistiky') + `
    <div class="page">
      <div class="stats-toggle">
        <button class="btn ${statsDays===7?'btn-primary':'btn-ghost'}" onclick="loadStats(7)">7 dní</button>
        <button class="btn ${statsDays===30?'btn-primary':'btn-ghost'}" onclick="loadStats(30)">30 dní</button>
      </div>
      <div class="section-card">
        <div class="section-title">Kalorický přehled</div>
        <div class="days-scroll" id="days-scroll">
          <div class="spinner"></div>
        </div>
      </div>
      <div class="section-card" id="day-detail">
        <div class="empty"><div class="empty-icon">👆</div>Klikni na den pro detail</div>
      </div>
    </div>
    ${renderNav('stats')}`;
  await loadStats(statsDays);
}

async function loadStats(days) {
  statsDays = days;
  // Update buttons
  document.querySelectorAll('.stats-toggle .btn').forEach((btn, i) => {
    const d = i === 0 ? 7 : 30;
    btn.className = `btn ${statsDays === d ? 'btn-primary' : 'btn-ghost'}`;
  });

  const data = await api(`stats?days=${days}`);
  const container = document.getElementById('days-scroll');
  if (!container) return;

  if (!data?.days || !Object.keys(data.days).length) {
    container.innerHTML = '<div class="loading-text">Žádná data</div>';
    return;
  }

  const goal = cachedMacroGoals.calories;
  const dayNames = ['Ne','Po','Út','St','Čt','Pá','So'];

  // Fill missing days
  const allDays = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    allDays.push({ key, d, data: data.days[key] || null });
  }

  let daysCache = {};

  container.innerHTML = allDays.map(({ key, d, data: dd }) => {
    if (dd) daysCache[key] = dd;
    const kcal = dd ? Math.round(dd.calories) : 0;
    const pct  = Math.min(kcal / goal, 1);
    const r    = 22;
    const circ = 2 * Math.PI * r;
    const dash = pct * circ;
    const color = !dd ? '#ddd' : pct < 0.7 ? '#1565c0' : pct < 1.1 ? '#43a047' : '#d32f2f';
    const dayLabel = d.toDateString() === new Date().toDateString() ? 'Dnes' : dayNames[d.getDay()];
    return `
      <div class="day-pill" onclick="showDayDetail('${key}')">
        <div class="day-label">${dayLabel}</div>
        <div class="day-circle-wrap">
          <svg width="54" height="54" viewBox="0 0 54 54">
            <circle cx="27" cy="27" r="${r}" fill="none" stroke="#eee" stroke-width="4"/>
            <circle cx="27" cy="27" r="${r}" fill="none" stroke="${color}" stroke-width="4"
              stroke-dasharray="${dash} ${circ}" stroke-linecap="round"/>
          </svg>
          <div class="day-circle-inner">
            <span class="day-kcal">${kcal||'—'}</span>
            <span class="day-kcal-lbl">kcal</span>
          </div>
        </div>
        <div class="day-date">${d.getDate()}.${d.getMonth()+1}</div>
      </div>`;
  }).join('');

  window._daysCache = daysCache;
}

function showDayDetail(dateKey) {
  const dd = window._daysCache?.[dateKey];
  const detail = document.getElementById('day-detail');
  if (!detail || !dd || !dd.calories) {
    if (detail) detail.innerHTML = `<div class="empty"><div class="empty-icon">🍽️</div>Žádná data pro tento den</div>`;
    return;
  }
  const g = cachedMacroGoals;
  const d = new Date(dateKey);
  const fmt = `${d.getDate()}. ${d.getMonth()+1}. ${d.getFullYear()}`;
  detail.innerHTML = `
    <div class="section-title">${fmt}</div>
    ${barRow('Kalorie','dc-cal','#f57c00')}
    ${barRow('Bílkoviny','dc-pro','#1565c0')}
    ${barRow('Sacharidy','dc-carb','#43a047')}
    ${barRow('Tuky','dc-fat','#6a1b9a')}`;
  setBar('dc-cal',  dd.calories||0, g.calories, `${Math.round(dd.calories)} / ${g.calories} kcal`, 'v-dc-cal');
  setBar('dc-pro',  dd.protein||0,  g.protein,  `${Math.round(dd.protein)} / ${g.protein} g`,      'v-dc-pro');
  setBar('dc-carb', dd.carbs||0,    g.carbs,    `${Math.round(dd.carbs)} / ${g.carbs} g`,          'v-dc-carb');
  setBar('dc-fat',  dd.fat||0,      g.fat,      `${Math.round(dd.fat)} / ${g.fat} g`,              'v-dc-fat');
}

// ═══════════════════════════════════════════════════════
//  PROFILE PAGE
// ═══════════════════════════════════════════════════════
async function renderProfile() {
  const app = document.getElementById('app');
  app.innerHTML = renderTopbar('Profil') + `
    <div class="page">
      <div class="section-card" id="profile-content">
        <div class="spinner"></div>
      </div>
    </div>
    ${renderNav('profile')}`;

  const p = await api('profile');
  cachedProfile = p;
  const user = getUser();
  const goals = p ? calcMacroGoals(p) : cachedMacroGoals;
  const initials = (user?.name || '?')[0].toUpperCase();
  const goalLabels = { lose: 'Zhubnout', muscle: 'Nabrat svaly', fit: 'Být fit' };
  const actLabels  = { sedentary: 'Sedavý', light: 'Lehce aktivní', moderate: 'Středně aktivní', active: 'Velmi aktivní' };

  document.getElementById('profile-content').innerHTML = `
    <div class="profile-header">
      <div class="profile-avatar">${initials}</div>
      <div>
        <div class="profile-name">${user?.name || ''}</div>
        <div class="profile-email">${user?.email || ''}</div>
      </div>
    </div>

    <div class="tdee-box">
      <div>
        <div class="tdee-label">Doporučený denní příjem</div>
        <div class="tdee-value">${goals.calories} kcal</div>
        <div class="tdee-sub">${goalLabels[p?.goal||'fit']} · ${actLabels[p?.activity||'light']}</div>
      </div>
      <div style="font-size:40px">🎯</div>
    </div>

    <div class="macro-grid" style="margin-bottom:20px">
      ${macroBox('protein', goals.protein, 'g', 'Bílkoviny')}
      ${macroBox('carbs',   goals.carbs,   'g', 'Sacharidy')}
      ${macroBox('fat',     goals.fat,     'g', 'Tuky')}
      ${macroBox('kcal',    goals.calories,'kcal','Energie')}
    </div>

    <div class="divider"></div>
    <div class="section-title" style="margin-bottom:16px">Upravit profil</div>

    <div class="field">
      <label>Cíl</label>
      <div class="goal-tabs" id="p-goal-tabs">
        <button data-val="lose"   class="${(p?.goal||'fit')==='lose'?'active':''}">Zhubnout</button>
        <button data-val="muscle" class="${(p?.goal||'fit')==='muscle'?'active':''}">Nabrat svaly</button>
        <button data-val="fit"    class="${(p?.goal||'fit')==='fit'?'active':''}">Být fit</button>
      </div>
    </div>

    <div class="profile-slider-wrap">
      <div class="profile-slider-head">
        <span>Hmotnost</span>
        <span id="lbl-weight">${p?.weight_kg||70} kg</span>
      </div>
      <input type="range" id="sl-weight" min="40" max="200" value="${p?.weight_kg||70}"
        oninput="document.getElementById('lbl-weight').textContent=this.value+' kg'"/>
    </div>

    <div class="profile-slider-wrap">
      <div class="profile-slider-head">
        <span>Výška</span>
        <span id="lbl-height">${p?.height_cm||170} cm</span>
      </div>
      <input type="range" id="sl-height" min="140" max="220" value="${p?.height_cm||170}"
        oninput="document.getElementById('lbl-height').textContent=this.value+' cm'"/>
    </div>

    <div class="profile-slider-wrap">
      <div class="profile-slider-head">
        <span>Cílová hmotnost</span>
        <span id="lbl-goal-w">${p?.goal_weight_kg||65} kg</span>
      </div>
      <input type="range" id="sl-goal-w" min="40" max="200" value="${p?.goal_weight_kg||65}"
        oninput="document.getElementById('lbl-goal-w').textContent=this.value+' kg'"/>
    </div>

    <div class="field" style="margin-top:8px">
      <label>Aktivita</label>
      <select id="p-activity">
        <option value="sedentary" ${p?.activity==='sedentary'?'selected':''}>Sedavý</option>
        <option value="light"     ${(p?.activity==='light'||!p?.activity)?'selected':''}>Lehce aktivní</option>
        <option value="moderate"  ${p?.activity==='moderate'?'selected':''}>Středně aktivní</option>
        <option value="active"    ${p?.activity==='active'?'selected':''}>Velmi aktivní</option>
      </select>
    </div>

    <button class="btn btn-primary" style="margin-top:8px" onclick="saveProfile()">Uložit změny</button>`;

  // Init goal tabs
  let selectedGoal = p?.goal || 'fit';
  document.querySelectorAll('#p-goal-tabs button').forEach(btn => {
    btn.onclick = () => {
      selectedGoal = btn.dataset.val;
      document.querySelectorAll('#p-goal-tabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    };
  });

  window._getProfileGoal = () => selectedGoal;
}

async function saveProfile() {
  const payload = {
    weight_kg:      parseFloat(document.getElementById('sl-weight').value),
    height_cm:      parseInt(document.getElementById('sl-height').value),
    goal_weight_kg: parseFloat(document.getElementById('sl-goal-w').value),
    activity:       document.getElementById('p-activity').value,
    goal:           window._getProfileGoal?.() || 'fit',
  };
  const data = await api('profile', { method: 'PATCH', body: JSON.stringify(payload) });
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
router();
