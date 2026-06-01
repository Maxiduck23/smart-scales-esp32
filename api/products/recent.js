// api/products/recent.js
// ESP32 endpoint.
// Auth: x-device-key
// Returns product list with macros for LCD.
// It does NOT require DEVICE_USER_ID. If DEVICE_USER_ID or DEVICE_USER_EMAIL exists,
// it first returns recent products for that user. Otherwise it falls back to latest products.

import supabase from '../_supabase.js';
import { requireDevice } from '../_middleware.js';

const PRODUCT_SELECT =
  'id,name,calories,protein_g,fat_g,carbs_g,fiber_g,salt_g,barcode,created_at';

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function productOut(p) {
  if (!p || !p.id) return null;
  return {
    id: String(p.id),
    name: p.name || 'Unknown product',
    calories: num(p.calories),
    protein_g: num(p.protein_g),
    fat_g: num(p.fat_g),
    carbs_g: num(p.carbs_g),
    fiber_g: num(p.fiber_g),
    salt_g: num(p.salt_g),
    barcode: p.barcode || null,
    created_at: p.created_at || null,
  };
}

function addUnique(list, seen, p) {
  const item = productOut(p);
  if (!item || seen.has(item.id)) return;
  seen.add(item.id);
  list.push(item);
}

async function resolveDeviceUserId() {
  if (process.env.DEVICE_USER_ID) {
    return process.env.DEVICE_USER_ID;
  }

  if (process.env.DEVICE_USER_EMAIL) {
    const { data, error } = await supabase
      .from('users')
      .select('id,email')
      .eq('email', process.env.DEVICE_USER_EMAIL)
      .limit(1);

    if (error) throw error;
    return data?.[0]?.id || null;
  }

  return null;
}

export default async function handler(req, res) {
  try {
    if (!requireDevice(req)) {
      return res.status(401).json({ error: 'Unauthorized: bad x-device-key' });
    }

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    res.setHeader('Cache-Control', 'no-store');

    const limit = Math.max(1, Math.min(parseInt(req.query.limit || '10', 10) || 10, 30));
    const userId = await resolveDeviceUserId();

    const items = [];
    const seen = new Set();

    // 1) If a user is configured, use that user's latest meals first.
    if (userId) {
      const { data: meals, error } = await supabase
        .from('meals')
        .select(`product_id,eaten_at,products(${PRODUCT_SELECT})`)
        .eq('user_id', userId)
        .order('eaten_at', { ascending: false })
        .limit(100);

      if (error) {
        return res.status(500).json({
          error: 'Failed to load recent meals',
          details: error.message,
        });
      }

      for (const meal of meals || []) {
        addUnique(items, seen, meal.products);
        if (items.length >= limit) break;
      }
    }

    // 2) Fallback: latest products from products table.
    // This is important for a single-scale project before meals exist.
    if (items.length < limit) {
      const { data: products, error } = await supabase
        .from('products')
        .select(PRODUCT_SELECT)
        .order('created_at', { ascending: false })
        .limit(limit * 4);

      if (error) {
        return res.status(500).json({
          error: 'Failed to load fallback products',
          details: error.message,
        });
      }

      for (const p of products || []) {
        addUnique(items, seen, p);
        if (items.length >= limit) break;
      }
    }

    return res.status(200).json({
      ok: true,
      user_mode: userId ? 'configured_user' : 'no_user_fallback_products',
      count: items.length,
      items,
    });
  } catch (err) {
    console.error('products/recent error:', err);
    return res.status(500).json({
      error: 'Internal Server Error',
      details: err?.message || String(err),
    });
  }
}
