// api/weight.js
// Saves raw scale weight and, when product_id is present, saves a normal meal row.

import supabase from './supabase.js';
import { requireDevice } from './middleware.js';

export default async function handler(req, res) {
  if (req.method === 'POST') {
    if (!requireDevice(req)) return res.status(401).json({ error: 'Unauthorized' });

    const { grams, product_id, meal_type } = req.body || {};
    const weight = Number(grams);

    if (!Number.isFinite(weight) || weight <= 0) {
      return res.status(400).json({ error: 'Invalid grams' });
    }

    const { error: logError } = await supabase
      .from('weight_log')
      .insert({ weight_g: weight });

    if (logError) return res.status(500).json({ error: logError.message });

    if (product_id) {
      const userId = process.env.DEVICE_USER_ID;
      if (!userId) {
        return res.status(500).json({
          error: 'DEVICE_USER_ID is not configured. Add it in Vercel env to save ESP32 meals.'
        });
      }

      const { error: mealError } = await supabase
        .from('meals')
        .insert({
          user_id: userId,
          product_id: String(product_id),
          weight_g: weight,
          meal_type: meal_type || 'snack'
        });

      if (mealError) return res.status(500).json({ error: mealError.message });
    }

    return res.json({ ok: true });
  }

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('weight_log')
      .select('*')
      .order('recorded_at', { ascending: false })
      .limit(1);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ grams: data?.[0]?.weight_g || null });
  }

  return res.status(405).end();
}
