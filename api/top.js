// api/products/top.js
// ESP32 endpoint.
// Auth: x-device-key
// Returns top eaten products with macros.
// If DEVICE_USER_ID or DEVICE_USER_EMAIL exists, filters by that user.
// Otherwise it aggregates all meals.

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
  };
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

function intRange(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(n, max));
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

    const days = intRange(req.query.days || '30', 30, 1, 365);
    const limit = intRange(req.query.limit || '10', 10, 1, 50);
    const userId = await resolveDeviceUserId();

    const from = new Date();
    from.setDate(from.getDate() - days);

    let query = supabase
      .from('meals')
      .select(`product_id,weight_g,eaten_at,products(${PRODUCT_SELECT})`)
      .gte('eaten_at', from.toISOString());

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data: meals, error } = await query;

    if (error) {
      return res.status(500).json({
        error: 'Failed to load meals',
        details: error.message,
      });
    }

    const map = new Map();

    for (const meal of meals || []) {
      const p = productOut(meal.products);
      if (!p) continue;

      const prev = map.get(p.id) || {
        ...p,
        total_grams: 0,
        count: 0,
      };

      prev.total_grams += Number(meal.weight_g || 0);
      prev.count += 1;
      map.set(p.id, prev);
    }

    const items = Array.from(map.values())
      .map((item) => ({
        ...item,
        total_grams: Math.round(item.total_grams * 10) / 10,
      }))
      .sort((a, b) => b.total_grams - a.total_grams)
      .slice(0, limit);

    return res.status(200).json({
      ok: true,
      user_mode: userId ? 'configured_user' : 'all_users',
      days,
      count: items.length,
      items,
    });
  } catch (err) {
    console.error('products/top error:', err);
    return res.status(500).json({
      error: 'Internal Server Error',
      details: err?.message || String(err),
    });
  }
}
