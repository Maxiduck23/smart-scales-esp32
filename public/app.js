// ═══════════════════════════════════════
// Správa JWT tokenu
// ═══════════════════════════════════════
const getToken = () => localStorage.getItem('token');
const saveToken = t => localStorage.setItem('token', t);

function logout() {
    localStorage.removeItem('token');
    router();
}

// ═══════════════════════════════════════
// Univerzální API funkce
// Automaticky přidává JWT token ke každému požadavku
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

    // Pokud token vypršel → odhlásíme uživatele
    if (res.status === 401) {
        logout();
        return null;
    }

    return res.json();
}

// ═══════════════════════════════════════
// Hlavní router
// Rozhoduje co zobrazit podle stavu přihlášení
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
// Stránka přihlášení
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
      <div class="link">
        Nemáte účet? <a onclick="renderRegisterPage()">Registrovat se</a>
      </div>
    </div>
  `;
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
        // Zobrazíme chybovou hlášku
        err.style.display = 'block';
        err.textContent = data?.error || 'Chyba přihlášení';
    }
}

// ═══════════════════════════════════════
// Stránka registrace
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
      <div class="link">
        Máte účet? <a onclick="router()">Přihlásit se</a>
      </div>
    </div>
  `;
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
// Dashboard
// Hlavní stránka po přihlášení
// ═══════════════════════════════════════
async function renderDashboard(app) {
    app.innerHTML = `
    <div class="dashboard">
      <div class="header">
        <h1 style="color:#1a6b3a">🍽️ Chytrá váha</h1>
        <button class="logout-btn" onclick="logout()">Odhlásit</button>
      </div>

      <!-- Zobrazení aktuální váhy z ESP32 -->
      <div class="weight-display">
        <div class="label">Aktuální váha</div>
        <div class="grams" id="weight-display">-- g</div>
        <div class="label" id="weight-status">Čekám na data z váhy...</div>
      </div>

      <!-- Denní příjem živin -->
      <div class="nutrition-card">
        <h3>📊 Dnešní příjem</h3>
        <div class="bar-row">
          <div class="bar-label">Kalorie</div>
          <div class="bar-track">
            <div class="bar-fill" id="bar-cal" style="width:0%;background:#e67e22"></div>
          </div>
          <div class="bar-value" id="val-cal">0 / 2000</div>
        </div>
        <div class="bar-row">
          <div class="bar-label">Bílkoviny</div>
          <div class="bar-track">
            <div class="bar-fill" id="bar-pro" style="width:0%;background:#2980b9"></div>
          </div>
          <div class="bar-value" id="val-pro">0 / 150g</div>
        </div>
        <div class="bar-row">
          <div class="bar-label">Sacharidy</div>
          <div class="bar-track">
            <div class="bar-fill" id="bar-carb" style="width:0%;background:#27ae60"></div>
          </div>
          <div class="bar-value" id="val-carb">0 / 250g</div>
        </div>
        <div class="bar-row">
          <div class="bar-label">Tuky</div>
          <div class="bar-track">
            <div class="bar-fill" id="bar-fat" style="width:0%;background:#8e44ad"></div>
          </div>
          <div class="bar-value" id="val-fat">0 / 65g</div>
        </div>
      </div>
    </div>
  `;

    // Aktualizujeme váhu každých 500ms
    setInterval(async () => {
        const data = await api('weight');
        if (data?.grams !== null && data?.grams !== undefined) {
            document.getElementById('weight-display').textContent = data.grams + ' g';
            document.getElementById('weight-status').textContent = '✓ Váha stabilizována';
        }
    }, 500);
}

// Spuštění aplikace
router();