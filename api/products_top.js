// api/products/top.js
// Returns top dishes by total grams for ESP32.

import supabase from '../supabase.js';
import { requireDevice } from '../middleware.js';

export default async function handler(req, res) {
  if (!requireDevice(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'GET') return res.status(405).end();

  const days = Math.max(1, Math.min(parseInt(req.query.days || '30', 10) || 30, 365));
  const limit = Math.max(1, Math.min(parseInt(req.query.limit || '10', 10) || 10, 50));
  const from = new Date();
  from.setDate(from.getDate() - days);

  let query = supabase
    .from('meals')
    .select('product_id, weight_g, eaten_at, products(id, name, calories)')
    .gte('eaten_at', from.toISOString());

  if (process.env.DEVICE_USER_ID) {
    query = query.eq('user_id', process.env.DEVICE_USER_ID);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const byProduct = new Map();
  for (const meal of data || []) {
    const product = meal.products || {};
    const id = product.id || meal.product_id;
    if (!id) continue;

    const prev = byProduct.get(id) || {
      id,
      name: product.name || 'Unknown dish',
      calories: Number(product.calories || 0),
      total_grams: 0,
      count: 0
    };

    prev.total_grams += Number(meal.weight_g || 0);
    prev.count += 1;
    byProduct.set(id, prev);
  }

  const items = Array.from(byProduct.values())
    .map((item) => ({
      ...item,
      total_grams: Math.round(item.total_grams * 10) / 10
    }))
    .sort((a, b) => b.total_grams - a.total_grams)
    .slice(0, limit);

  return res.json({ days, items });
}
