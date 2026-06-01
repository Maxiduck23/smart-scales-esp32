import supabase from './_supabase.js';
import { requireAuth } from './_middleware.js';

function cleanName(name) {
  return (name || 'Neznámý produkt')
    .replace(/&quot;/gi, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Normalize a raw product object into our DB schema ────────────────────────
function normalize(p) {
  return {
    name: cleanName(p.name),
    barcode: p.barcode || null,
    image_url: p.image_url || null,
    calories: p.calories || null,
    protein_g: p.protein_g || null,
    fat_g: p.fat_g || null,
    carbs_g: p.carbs_g || null,
    fiber_g: p.fiber_g || null,
  };
}

// ─── OpenFoodFacts: search by TEXT ─────────────────────────────────────────────
async function searchOFF_text(q) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&fields=product_name,nutriments,image_front_url,code&page_size=10&lc=cs`,
      { signal: controller.signal, headers: { 'User-Agent': 'SmartScales/1.0 (school project)' } }
    );
    clearTimeout(timeout);
    if (!res.ok) return [];
    const d = await res.json();
    return (d.products || [])
      .filter(p => p.nutriments?.['energy-kcal_100g'])
      .map(p => normalize({
        name: p.product_name,
        barcode: p.code || null,
        image_url: p.image_front_url || null,
        calories: p.nutriments['energy-kcal_100g'],
        protein_g: p.nutriments['proteins_100g'] || null,
        fat_g: p.nutriments['fat_100g'] || null,
        carbs_g: p.nutriments['carbohydrates_100g'] || null,
        fiber_g: p.nutriments['fiber_100g'] || null,
      }));
  } catch { clearTimeout(timeout); return []; }
}

// ─── OpenFoodFacts: search by BARCODE ──────────────────────────────────────────
async function searchOFF_barcode(barcode) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(barcode)}.json`,
      { signal: controller.signal, headers: { 'User-Agent': 'SmartScales/1.0 (school project)' } }
    );
    clearTimeout(timeout);
    if (!res.ok) return null;
    const d = await res.json();
    if (d.status !== 1 || !d.product?.nutriments?.['energy-kcal_100g']) return null;
    const p = d.product;
    return normalize({
      name: p.product_name || p.product_name_cs || p.product_name_en,
      barcode,
      image_url: p.image_front_url || null,
      calories: p.nutriments['energy-kcal_100g'],
      protein_g: p.nutriments['proteins_100g'] || null,
      fat_g: p.nutriments['fat_100g'] || null,
      carbs_g: p.nutriments['carbohydrates_100g'] || null,
      fiber_g: p.nutriments['fiber_100g'] || null,
    });
  } catch { clearTimeout(timeout); return null; }
}

// ─── UPCitemdb: search by BARCODE (free tier, 100 req/day) ────────────────────
async function searchUPC_barcode(barcode) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(
      `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`,
      {
        signal: controller.signal,
        headers: {
          'User-Agent': 'SmartScales/1.0 (school project)',
          'Accept': 'application/json',
        }
      }
    );
    clearTimeout(timeout);
    if (!res.ok) return null;
    const d = await res.json();
    const item = d.items?.[0];
    if (!item) return null;
    // UPCitemdb returns nutrition in 'nutrition' object (not always present)
    const nut = item.nutrition || {};
    const calories = parseFloat(nut.energy_kcal) || null;
    return normalize({
      name: item.title || item.brand,
      barcode,
      image_url: item.images?.[0] || null,
      calories,
      protein_g: parseFloat(nut.protein) || null,
      fat_g: parseFloat(nut.fat) || null,
      carbs_g: parseFloat(nut.carbohydrates) || null,
      fiber_g: parseFloat(nut.fiber) || null,
    });
  } catch { clearTimeout(timeout); return null; }
}

// ─── Save products to Supabase and return rows with IDs ───────────────────────
async function saveAndFetch(found, searchKey, isBarcode = false) {
  const withBarcode = found.filter(p => p.barcode);
  const withoutBarcode = found.filter(p => !p.barcode);

  if (withBarcode.length > 0)
    await supabase.from('products').upsert(withBarcode, { onConflict: 'barcode' });

  for (const p of withoutBarcode) {
    const { data: exists } = await supabase
      .from('products').select('id').ilike('name', p.name).limit(1);
    if (!exists?.length) await supabase.from('products').insert(p);
  }

  if (isBarcode) {
    const { data } = await supabase
      .from('products').select('*').eq('barcode', searchKey).limit(1);
    return data || [];
  }

  const { data } = await supabase
    .from('products').select('*').ilike('name', `%${searchKey}%`).limit(10);
  return data || [];
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HANDLER
// ═══════════════════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  try {
    const user = requireAuth(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { q, barcode } = req.query;

    // ── BARCODE SEARCH ────────────────────────────────────────────────────────
    if (barcode) {
      // 1. Local Supabase cache — exact barcode match
      const { data: local } = await supabase
        .from('products').select('*').eq('barcode', barcode).limit(1);
      if (local?.length > 0) return res.json(local);

      // 2. OpenFoodFacts barcode endpoint (most accurate)
      let product = await searchOFF_barcode(barcode);

      // 3. UPCitemdb fallback
      if (!product) product = await searchUPC_barcode(barcode);

      if (!product)
        return res.json([]);          // nothing found

      // Save and return with DB id
      const saved = await saveAndFetch([product], barcode, true);
      return res.json(saved.length ? saved : [product]);
    }

    // ── TEXT SEARCH ───────────────────────────────────────────────────────────
    if (!q) return res.status(400).json({ error: 'Missing query' });

    // 1. Supabase cache
    const { data: local, error: dbError } = await supabase
      .from('products').select('*').ilike('name', `%${q}%`).limit(10);
    if (dbError) throw dbError;
    if (local?.length > 0) return res.json(local);

    // 2. OpenFoodFacts text search (with retry)
    let products = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const found = await searchOFF_text(q);
      if (found.length > 0) {
        products = await saveAndFetch(found, q);
        break;
      }
      if (attempt < 3) await new Promise(r => setTimeout(r, 500));
    }

    return res.json(products);

  } catch (err) {
    console.error('products handler error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}