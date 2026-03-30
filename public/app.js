// ═══════════════════════════════════════
// JWT токен
// ═══════════════════════════════════════
const getToken = () => localStorage.getItem('token');
const saveToken = t => localStorage.setItem('token', t);

function logout() {
    localStorage.removeItem('token');
    router();
}

// ═══════════════════════════════════════
// Универсальный API запрос
// ═══════════════════════════════════════
async function api(path, options = {}) {
    const res = await fetch(`/api/${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getToken()}`,
            ...options.headers
        }
    });
    if (res.status === 401) { logout(); return null; }
    return res.json();
}

// ═══════════════════════════════════════
// Роутер
// ═══════════════════════════════════════
function router() {
    const app = document.getElementById('app');
    if (getToken()) {
        renderDashboard(app);
    } else {
        renderLogin(app);
    }
}

// ═══════════════════════════════════════
// Логин
// ═══════════════════════════════════════
function renderLogin(app) {
    app.innerHTML = `
    <div class="card">
      <h1>🍽️ Chytrá váha</h1>
      <p>Přihlaste se ke svému účtu</p>
      <div class="error" id="err"></div>
      <input type="email" id="email" placeholder="Email" />
      <input type="password" id="password" placeholder="Heslo" />
      <button onclick="doLogin()">Přihlásit se</button>
      <div class="link">Nemáte účet? <a onclick="renderRegisterPage()">Registrovat se</a></div>
    </div>`;
}

async function doLogin() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const err = document.getElementById('err');
    const data = await api('auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
    });
    if (data?.token) {
        saveToken(data.token);
        router();
    } else {
        err.style.display = 'block';
        err.textContent = data?.error || 'Chyba přihlášení';
    }
}

// ═══════════════════════════════════════
// Регистрация
// ═══════════════════════════════════════
function renderRegisterPage() {
    const app = document.getElementById('app');
    app.innerHTML = `
    <div class="card">
      <h1>🍽️ Registrace</h1>
      <p>Vytvořte si nový účet</p>
      <div class="error" id="err"></div>
      <input type="text"     id="name"     placeholder="Jméno" />
      <input type="email"    id="email"    placeholder="Email" />
      <input type="password" id="password" placeholder="Heslo" />
      <button onclick="doRegister()">Registrovat se</button>
      <div class="link">Máte účet? <a onclick="router()">Přihlásit se</a></div>
    </div>`;
}

async function doRegister() {
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const err = document.getElementById('err');
    const data = await api('auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password })
    });
    if (data?.token) {
        saveToken(data.token);
        router();
    } else {
        err.style.display = 'block';
        err.textContent = data?.error || 'Chyba registrace';
    }
}

// ═══════════════════════════════════════
// Дашборд
// ═══════════════════════════════════════
async function renderDashboard(app) {
    app.innerHTML = `
    <div class="dashboard">
      <div class="header">
        <h1 style="color:#1a6b3a">🍽️ Chytrá váha</h1>
        <button class="logout-btn" onclick="logout()">Odhlásit</button>
      </div>
      <div class="weight-display">
        <div class="label">Aktuální váha</div>
        <div class="grams" id="weight-display">-- g</div>
        <div class="label" id="weight-status">Čekám na data z váhy...</div>
      </div>
      <div class="nutrition-card">
        <h3>📊 Dnešní příjem</h3>
        <div class="bar-row">
          <div class="bar-label">Kalorie</div>
          <div class="bar-track"><div class="bar-fill" id="bar-cal" style="width:0%;background:#e67e22"></div></div>
          <div class="bar-value" id="val-cal">0 / 2000</div>
        </div>
        <div class="bar-row">
          <div class="bar-label">Bílkoviny</div>
          <div class="bar-track"><div class="bar-fill" id="bar-pro" style="width:0%;background:#2980b9"></div></div>
          <div class="bar-value" id="val-pro">0 / 150g</div>
        </div>
        <div class="bar-row">
          <div class="bar-label">Sacharidy</div>
          <div class="bar-track"><div class="bar-fill" id="bar-carb" style="width:0%;background:#27ae60"></div></div>
          <div class="bar-value" id="val-carb">0 / 250g</div>
        </div>
        <div class="bar-row">
          <div class="bar-label">Tuky</div>
          <div class="bar-track"><div class="bar-fill" id="bar-fat" style="width:0%;background:#8e44ad"></div></div>
          <div class="bar-value" id="val-fat">0 / 65g</div>
        </div>
      </div>
      <div class="nutrition-card">
        <h3>🔍 Přidat jídlo</h3>
        <div class="search-group">
          <input type="text" id="search-input" placeholder="Hledat potravinu..."/>
          <button onclick="searchFood()">Hledat</button>
        </div>
        <div id="search-results"></div>
      </div>
      <div class="nutrition-card">
        <h3>🍽️ Dnes jsem jedl</h3>
        <div id="meals-list">Načítám...</div>
      </div>
    </div>`;

    setInterval(async () => {
        const data = await api('weight');
        if (data?.grams != null) {
            document.getElementById('weight-display').textContent = data.grams + ' g';
            document.getElementById('weight-status').textContent = '✓ Váha stabilizována';
        }
    }, 500);

    await loadMeals();
}

// ═══════════════════════════════════════
// Jídla
// ═══════════════════════════════════════
async function searchFood() {
    const q = document.getElementById('search-input').value.trim();
    if (!q) return;
    const results = document.getElementById('search-results');
    results.innerHTML = '<p>Hledám...</p>';
    const data = await api(`products?q=${encodeURIComponent(q)}`);
    if (!data?.length) { results.innerHTML = '<p>Nic nenalezeno</p>'; return; }
    results.innerHTML = data.map(p => `
        <div class="meal-item">
            <div style="display:flex;align-items:center;gap:10px">
                ${p.image_url ? `<img src="${p.image_url}" style="width:40px;height:40px;object-fit:cover;border-radius:6px">` : ''}
                <div>
                    <strong>${p.name}</strong><br>
                    <small>${p.calories} kcal | B: ${p.protein_g ?? '?'}g T: ${p.fat_g ?? '?'}g S: ${p.carbs_g ?? '?'}g</small>
                </div>
            </div>
            <div style="display:flex;gap:6px;align-items:center;margin-top:8px">
                <input type="number" id="grams-${p.barcode}" value="100" min="1"/>
                <span>g</span>
                <button onclick="addMeal('${p.barcode}', '${p.name}')">+ Přidat</button>
            </div>
        </div>`).join('');
}

async function addMeal(barcode, name) {
    const products = await api(`products?q=${encodeURIComponent(name)}`);
    const product = products?.find(p => p.barcode === barcode);
    if (!product?.id) return alert('Produkt nenalezen v databázi');
    const grams = parseInt(document.getElementById(`grams-${barcode}`).value);
    await api('meals', {
        method: 'POST',
        body: JSON.stringify({ product_id: product.id, weight_g: grams, meal_type: 'snack' })
    });
    await loadMeals();
}

async function loadMeals() {
    const data = await api('meals');
    if (!data?.totals) return;
    const t = data.totals;
    document.getElementById('val-cal').textContent = `${Math.round(t.calories)} / 2000`;
    document.getElementById('bar-cal').style.width = `${Math.min(t.calories / 2000 * 100, 100)}%`;
    document.getElementById('val-pro').textContent = `${Math.round(t.protein)}g / 150g`;
    document.getElementById('bar-pro').style.width = `${Math.min(t.protein / 150 * 100, 100)}%`;
    document.getElementById('val-carb').textContent = `${Math.round(t.carbs)}g / 250g`;
    document.getElementById('bar-carb').style.width = `${Math.min(t.carbs / 250 * 100, 100)}%`;
    document.getElementById('val-fat').textContent = `${Math.round(t.fat)}g / 65g`;
    document.getElementById('bar-fat').style.width = `${Math.min(t.fat / 65 * 100, 100)}%`;
    const list = document.getElementById('meals-list');
    if (!list) return;
    if (!data.meals?.length) { list.innerHTML = '<p>Zatím nic</p>'; return; }
    list.innerHTML = data.meals.map(m => `
        <div class="meal-item" style="display:flex;justify-content:space-between;align-items:center">
            <div>
                <strong>${m.products.name}</strong><br>
                <small>${m.weight_g}g · ${Math.round(m.products.calories * m.weight_g / 100)} kcal</small>
            </div>
            <button onclick="deleteMeal(${m.id})" style="background:#e74c3c;width:auto;padding:6px 12px">✕</button>
        </div>`).join('');
}

async function deleteMeal(id) {
    await api('meals', { method: 'DELETE', body: JSON.stringify({ meal_id: id }) });
    await loadMeals();
}

// Старт
router();