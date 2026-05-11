// UI override for product selection + weight input flow
// Loaded after app.js. It removes the always-visible dashboard scale,
// disables the broken favorites UI calls, and lets the user choose a product
// first, then enter grams manually or read grams from the ESP32 scale.

(function () {
  var selectedProduct = null;
  var scalePollId = null;
  var lastScaleGrams = 0;

  function byId(id) { return document.getElementById(id); }

  function safeToast(msg) {
    if (typeof showToast === 'function') showToast(msg);
    else console.log(msg);
  }

  function productCaloriesText(p) {
    return (p && p.calories != null ? Math.round(Number(p.calories)) : '?') + ' kcal / 100 g';
  }

  function injectFixStyles() {
    if (byId('app-fix-styles')) return;
    var style = document.createElement('style');
    style.id = 'app-fix-styles';
    style.textContent = `
      .product-flow-help {
        margin-top: 8px;
        padding: 10px 12px;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        color: var(--text-2);
        font-size: 13px;
        background: var(--bg-soft, rgba(46, 125, 50, 0.06));
      }
      .product-result.choose-mode {
        align-items: center;
      }
      .product-result .choose-product-btn {
        white-space: nowrap;
      }
      #weight-choice-modal {
        position: fixed;
        inset: 0;
        z-index: 9600;
        background: rgba(0, 0, 0, 0.78);
        display: flex;
        align-items: flex-end;
        justify-content: center;
      }
      #weight-choice-modal .wc-box {
        width: 100%;
        max-width: 520px;
        max-height: 92vh;
        overflow-y: auto;
        background: var(--card);
        color: var(--text);
        border-radius: var(--radius) var(--radius) 0 0;
        padding: 18px 18px 28px;
        box-shadow: var(--shadow-lg);
      }
      .wc-handle {
        width: 42px;
        height: 4px;
        border-radius: 99px;
        margin: 0 auto 14px;
        background: var(--border);
      }
      .wc-title {
        font-size: 18px;
        font-weight: 800;
        color: var(--green);
        margin-bottom: 4px;
        text-align: center;
      }
      .wc-product-name {
        text-align: center;
        font-size: 14px;
        color: var(--text-2);
        margin-bottom: 14px;
      }
      .wc-options {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-bottom: 14px;
      }
      .wc-option {
        border: 1.5px solid var(--border);
        background: var(--card);
        color: var(--text);
        border-radius: var(--radius-sm);
        padding: 12px 8px;
        font-family: inherit;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
      }
      .wc-option.active {
        border-color: var(--green);
        background: var(--green-light);
        color: var(--green);
      }
      .wc-pane { display: none; }
      .wc-pane.active { display: block; }
      .wc-scale-card {
        border: 1.5px solid var(--border);
        border-radius: var(--radius-sm);
        padding: 16px 12px;
        text-align: center;
        margin-bottom: 10px;
      }
      .wc-scale-value {
        font-family: 'DM Mono', monospace;
        font-size: 48px;
        line-height: 1;
        color: var(--green);
        letter-spacing: -1px;
      }
      .wc-scale-value span {
        font-size: 20px;
        opacity: .7;
        margin-left: 4px;
      }
      .wc-status {
        margin-top: 8px;
        font-size: 12px;
        color: var(--text-3);
      }
      .wc-actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 12px;
      }
      .favorite-products-disabled {
        color: var(--text-3);
        font-size: 13px;
        padding: 8px 0;
      }
    `;
    document.head.appendChild(style);
  }

  // Stop the old app from calling /api/favorites on the new dashboard.
  window.loadFavorites = async function () {
    window.favoritesCache = {};
    return { favorites: [] };
  };

  window.renderFavoriteProducts = function () {
    var box = byId('favorite-products');
    if (box) box.innerHTML = '<div class="favorite-products-disabled">Oblíbená jídla jsou zatím vypnutá.</div>';
  };

  // No permanent weight polling on the dashboard.
  window.startWeightPolling = function () {
    if (typeof clearWeightInterval === 'function') clearWeightInterval();
  };

  window.renderDashboard = async function () {
    injectFixStyles();
    if (typeof clearWeightInterval === 'function') clearWeightInterval();

    var app = byId('app');
    if (!app) return;
    var g = typeof getGreeting === 'function'
      ? getGreeting()
      : { cssClass: 'morning', emoji: '🌅', period: '', text: 'Co budeme zapisovat?' };

    app.innerHTML = renderTopbar('Chytrá váha')
      + '<div class="page" id="dash-page">'
      + '<div class="greeting-hero ' + g.cssClass + '">'
      + '<div class="greeting-emoji">' + g.emoji + '</div>'
      + '<div class="greeting-time">' + g.period + '</div>'
      + '<div class="greeting-text">' + g.text + '</div>'
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
      + '<div class="section-title">🔍 Najít a přidat produkt</div>'
      + '<div class="search-wrap">'
      + '<input type="text" id="search-input" placeholder="Název produktu nebo čárový kód..."/>'
      + '<button class="btn btn-primary btn-sm" onclick="searchFood()">🔍</button>'
      + '<button class="scan-btn" onclick="openScanner()" title="Skenovat">📷</button>'
      + '<button class="manual-open-btn" onclick="openManualProduct()" title="Přidat vlastní">➕</button>'
      + '</div>'
      + '<div class="product-flow-help">Vyber produkt. Potom si zvolíš, jestli gramáž napíšeš ručně, nebo ji vezmeš z ESP32 váhy.</div>'
      + '<div id="search-results"></div>'
      + '</div>'
      + '<div class="section-card">'
      + '<div class="section-title"><span>Dnes jsem jedl</span><span id="total-kcal-badge" style="font-size:12px;color:var(--text-3);font-weight:400"></span></div>'
      + '<div id="meals-list"><div class="spinner"></div></div>'
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

    var input = byId('search-input');
    if (input) {
      input.addEventListener('input', function () {
        clearTimeout(window.searchTimer);
        window.searchTimer = setTimeout(window.searchFood, 480);
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') window.searchFood();
      });
    }

    if (typeof loadMealsAndProfile === 'function') await loadMealsAndProfile();
    if (typeof initWaterTracking === 'function') initWaterTracking();
    if (typeof addStatusLog === 'function') addStatusLog('info', 'Dashboard načten bez trvalého zobrazení váhy');
  };

  window.searchFood = async function () {
    var input = byId('search-input');
    var results = byId('search-results');
    if (!input || !results) return;

    var q = input.value.trim();
    if (!q) {
      results.innerHTML = '';
      return;
    }

    results.innerHTML = '<div class="loading-text">Hledám produkt...</div>';
    var data = /^\d{8,14}$/.test(q)
      ? await api('products?barcode=' + encodeURIComponent(q))
      : await api('products?q=' + encodeURIComponent(q));

    renderProductChoiceResults(data || [], q);
  };

  function renderProductChoiceResults(products, label) {
    var results = byId('search-results');
    if (!results) return;

    if (!products.length) {
      results.innerHTML = '<div class="loading-text">Produkt nenalezen. Zkus jiný název, čárový kód nebo ruční přidání přes ➕.</div>';
      return;
    }

    window.productsCache = window.productsCache || {};
    var html = label && /^\d{8,14}$/.test(label) ? '<div class="barcode-badge">🔖 ' + escapeHtml(label) + '</div>' : '';

    products.forEach(function (p, idx) {
      var pid = p.id != null ? String(p.id) : 'missing-' + idx;
      window.productsCache[pid] = p;
      var img = p.image_url
        ? '<img class="product-img" src="' + escapeHtml(p.image_url) + '" alt="">'
        : '<div class="product-img-placeholder">🥫</div>';
      var disabled = p.id == null ? ' disabled title="Produkt nemá ID v databázi"' : '';

      html += '<div class="product-result choose-mode">'
        + img
        + '<div class="product-info">'
        + '<div class="product-name">' + escapeHtml(p.name || 'Neznámý produkt') + '</div>'
        + '<div class="product-kcal">' + productCaloriesText(p) + '</div>'
        + '</div>'
        + '<div class="product-add">'
        + '<button class="btn btn-primary btn-sm choose-product-btn" data-pid="' + escapeHtml(pid) + '"' + disabled + '>Vybrat</button>'
        + '</div>'
        + '</div>';
    });

    results.innerHTML = html;
    results.querySelectorAll('.choose-product-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openWeightChoiceModal(btn.getAttribute('data-pid'));
      });
    });
  }

  window.handleScannedBarcode = async function (barcode) {
    var input = byId('search-input');
    if (input) input.value = '';
    var results = byId('search-results');
    if (!results) return;

    results.innerHTML = '<div class="barcode-badge">🔖 ' + escapeHtml(barcode) + '</div><div class="loading-text">Hledám produkt...</div>';
    var data = await api('products?barcode=' + encodeURIComponent(barcode));
    renderProductChoiceResults(data || [], barcode);
  };

  window.openWeightChoiceModal = function (productId) {
    stopScalePolling();
    lastScaleGrams = 0;

    var product = window.productsCache && window.productsCache[String(productId)];
    if (!product || !product.id) {
      safeToast('Produkt nejde přidat, chybí ID v databázi. Zkus ho vyhledat znovu.');
      return;
    }
    selectedProduct = product;

    var old = byId('weight-choice-modal');
    if (old) old.remove();

    var modal = document.createElement('div');
    modal.id = 'weight-choice-modal';
    modal.innerHTML = buildWeightChoiceHtml(product);
    document.body.appendChild(modal);

    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeWeightChoiceModal();
    });

    setWeightMode('manual');
  };

  function buildWeightChoiceHtml(product) {
    return '<div class="wc-box">'
      + '<div class="wc-handle"></div>'
      + '<div class="wc-title">Gramáž produktu</div>'
      + '<div class="wc-product-name">' + escapeHtml(product.name || 'Produkt') + '</div>'
      + '<div class="wc-options">'
      + '<button class="wc-option" id="wc-manual-btn" onclick="setWeightMode(\'manual\')">✏️ Napsat ručně</button>'
      + '<button class="wc-option" id="wc-scale-btn" onclick="setWeightMode(\'scale\')">⚖️ Použít váhu</button>'
      + '</div>'
      + '<div class="wc-pane" id="wc-manual-pane">'
      + '<div class="field"><label>Gramáž (g)</label><input type="number" id="wc-manual-grams" min="1" value="100" placeholder="např. 150"></div>'
      + '<button class="btn btn-primary" onclick="addSelectedProductManual()">Přidat ručně</button>'
      + '</div>'
      + '<div class="wc-pane" id="wc-scale-pane">'
      + '<div class="wc-scale-card">'
      + '<div class="wc-scale-value" id="wc-scale-value">--<span>g</span></div>'
      + '<div class="wc-status" id="wc-scale-status">Polož produkt na váhu...</div>'
      + '</div>'
      + '<button class="btn btn-primary" onclick="addSelectedProductFromScale()">Přidat z váhy</button>'
      + '</div>'
      + '<div class="wc-actions">'
      + '<button class="btn btn-ghost btn-sm" onclick="closeWeightChoiceModal()">Zrušit</button>'
      + '</div>'
      + '</div>';
  }

  window.setWeightMode = function (mode) {
    var manualBtn = byId('wc-manual-btn');
    var scaleBtn = byId('wc-scale-btn');
    var manualPane = byId('wc-manual-pane');
    var scalePane = byId('wc-scale-pane');

    if (manualBtn) manualBtn.classList.toggle('active', mode === 'manual');
    if (scaleBtn) scaleBtn.classList.toggle('active', mode === 'scale');
    if (manualPane) manualPane.classList.toggle('active', mode === 'manual');
    if (scalePane) scalePane.classList.toggle('active', mode === 'scale');

    if (mode === 'scale') startScalePolling();
    else stopScalePolling();
  };

  function startScalePolling() {
    stopScalePolling();
    scalePollId = setInterval(async function () {
      var valueEl = byId('wc-scale-value');
      var statusEl = byId('wc-scale-status');
      if (!valueEl) {
        stopScalePolling();
        return;
      }

      var data = await api('weight');
      if (data && data.grams != null && !Number.isNaN(Number(data.grams))) {
        lastScaleGrams = Math.max(0, Math.round(Number(data.grams)));
        valueEl.innerHTML = lastScaleGrams + '<span>g</span>';
        if (statusEl) statusEl.textContent = lastScaleGrams > 0 ? 'Váha načtena' : 'Váha ukazuje 0 g';
      } else if (statusEl) {
        statusEl.textContent = 'Čekám na ESP32 váhu...';
      }
    }, 650);
  }

  function stopScalePolling() {
    if (scalePollId) {
      clearInterval(scalePollId);
      scalePollId = null;
    }
  }

  window.closeWeightChoiceModal = function () {
    stopScalePolling();
    var modal = byId('weight-choice-modal');
    if (modal) modal.remove();
  };

  window.addSelectedProductManual = async function () {
    var input = byId('wc-manual-grams');
    var grams = Math.round(Number(input && input.value));
    await addSelectedProductMeal(grams);
  };

  window.addSelectedProductFromScale = async function () {
    await addSelectedProductMeal(lastScaleGrams);
  };

  async function addSelectedProductMeal(grams) {
    if (!selectedProduct || !selectedProduct.id) {
      safeToast('Nejdřív vyber produkt.');
      return;
    }
    if (!grams || grams <= 0) {
      safeToast('Gramáž musí být větší než 0 g.');
      return;
    }

    var data = await api('meals', {
      method: 'POST',
      body: JSON.stringify({
        product_id: selectedProduct.id,
        weight_g: grams,
        meal_type: 'snack'
      })
    });

    if (data && !data.error) {
      var name = selectedProduct.name || 'Produkt';
      closeWeightChoiceModal();
      selectedProduct = null;
      safeToast('✓ Přidáno: ' + name + ' (' + grams + ' g)');
      if (typeof loadMeals === 'function') await loadMeals();
      else if (typeof loadMealsAndProfile === 'function') await loadMealsAndProfile();
    } else {
      safeToast('Nepovedlo se přidat jídlo. Zkontroluj připojení/API.');
    }
  }

  // Re-render after app.js initial render, so the old dashboard disappears immediately.
  injectFixStyles();
  setTimeout(function () {
    if (typeof getToken === 'function' && getToken() && window.currentPage !== 'stats' && window.currentPage !== 'profile') {
      window.renderDashboard();
    }
  }, 0);
})();
