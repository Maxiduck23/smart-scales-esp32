async function searchFood() {
    const q = document.getElementById('search-input').value.trim();
    if (!q) return;

    const results = document.getElementById('search-results');
    results.innerHTML = '<p>Hledám...</p>';

    const data = await api(`products?q=${encodeURIComponent(q)}`);
    if (!data?.length) {
        results.innerHTML = '<p>Nic nenalezeno</p>';
        return;
    }

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
                <input type="number" id="grams-${p.barcode}" value="100" min="1" style="width:70px"/>
                <span>g</span>
                <button onclick="addMeal('${p.barcode}', '${p.name}')">+ Přidat</button>
            </div>
        </div>
    `).join('');
}

async function addMeal(barcode, name) {
    // Nejdřív najdeme product_id v DB
    const products = await api(`products?q=${encodeURIComponent(name)}`);
    const product = products?.find(p => p.barcode === barcode);
    if (!product?.id) return alert('Produkt nenalezen v databázi');

    const grams = parseInt(document.getElementById(`grams-${barcode}`).value);

    await api('meals', {
        method: 'POST',
        body: JSON.stringify({ product_id: product.id, weight_g: grams, meal_type: 'snack' })
    });

    await loadMeals(); // aktualizuj progy bary
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

    // Seznam jídel
    const list = document.getElementById('meals-list');
    if (!list) return;
    if (!data.meals?.length) { list.innerHTML = '<p>Zatím nic</p>'; return; }

    list.innerHTML = data.meals.map(m => `
        <div class="meal-item" style="display:flex;justify-content:space-between;align-items:center">
            <div>
                <strong>${m.products.name}</strong><br>
                <small>${m.weight_g}g · ${Math.round(m.products.calories * m.weight_g / 100)} kcal</small>
            </div>
            <button onclick="deleteMeal(${m.id})" style="background:#e74c3c">✕</button>
        </div>
    `).join('');
}

async function deleteMeal(id) {
    await api('meals', { method: 'DELETE', body: JSON.stringify({ meal_id: id }) });
    await loadMeals();
}