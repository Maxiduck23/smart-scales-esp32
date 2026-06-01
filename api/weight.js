// api/weight.js
// ESP32 endpoint.
// Auth: x-device-key
//
// Important:
// DEVICE_KEY identifies the scale/device.
// DEVICE_USER_ID / DEVICE_USER_EMAIL identifies the app user for meal rows.
// If there is no configured user and product_id is sent, this endpoint gives a clear error.
// Sending weight without product_id still works.

import supabase from './_supabase.js';
import { requireDevice } from './_middleware.js';

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : null;
}

async function resolveDeviceUserId() {
  if (process.env.DEVICE_USER_ID) {
    return {
      id: process.env.DEVICE_USER_ID,
      mode: 'DEVICE_USER_ID',
    };
  }

  if (process.env.DEVICE_USER_EMAIL) {
    const { data, error } = await supabase
      .from('users')
      .select('id,email')
      .eq('email', process.env.DEVICE_USER_EMAIL)
      .limit(1);

    if (error) throw error;

    if (data?.[0]?.id) {
      return {
        id: data[0].id,
        mode: 'DEVICE_USER_EMAIL',
      };
    }

    return {
      id: null,
      mode: 'DEVICE_USER_EMAIL_NOT_FOUND',
    };
  }

  // Safe fallback: only auto-pick if there is exactly one user.
  // If there are multiple users, do not guess.
  const { data, error } = await supabase
    .from('users')
    .select('id,email')
    .limit(2);

  if (error) throw error;

  if ((data || []).length === 1) {
    return {
      id: data[0].id,
      mode: 'ONLY_USER_IN_TABLE',
    };
  }

  return {
    id: null,
    mode: (data || []).length === 0 ? 'NO_USERS' : 'MULTIPLE_USERS_NO_CONFIG',
  };
}

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      if (!requireDevice(req)) {
        return res.status(401).json({ error: 'Unauthorized: bad x-device-key' });
      }

      const { grams, product_id, meal_type } = req.body || {};
      const weight = positiveNumber(grams);

      if (!weight) {
        return res.status(400).json({
          error: 'Invalid grams',
          received: grams,
        });
      }

      // weight_log works even without a user.
      const logRow = { weight_g: weight };

      const resolvedUser = await resolveDeviceUserId();
      if (resolvedUser.id) {
        logRow.user_id = resolvedUser.id;
      }

      const { error: logError } = await supabase
        .from('weight_log')
        .insert(logRow);

      if (logError) {
        return res.status(500).json({
          error: 'Failed to save weight_log',
          details: logError.message,
          row: logRow,
        });
      }

      let mealSaved = false;

      if (product_id) {
        if (!resolvedUser.id) {
          return res.status(400).json({
            error: 'Cannot save meal: no target user is configured',
            explanation:
              'DEVICE_KEY identifies the scale. Meal rows also need a user_id. Set DEVICE_USER_EMAIL in Vercel, or DEVICE_USER_ID.',
            user_resolve_mode: resolvedUser.mode,
            weight_saved: true,
            meal_saved: false,
          });
        }

        const { data: product, error: productError } = await supabase
          .from('products')
          .select('id,name')
          .eq('id', String(product_id))
          .limit(1);

        if (productError) {
          return res.status(500).json({
            error: 'Failed to check product_id',
            details: productError.message,
          });
        }

        if (!product?.length) {
          return res.status(400).json({
            error: 'Unknown product_id',
            product_id: String(product_id),
            weight_saved: true,
            meal_saved: false,
          });
        }

        const mealRow = {
          user_id: resolvedUser.id,
          product_id: String(product_id),
          weight_g: weight,
          meal_type: meal_type || 'snack',
        };

        const { error: mealError } = await supabase
          .from('meals')
          .insert(mealRow);

        if (mealError) {
          return res.status(500).json({
            error: 'Failed to save meal',
            details: mealError.message,
            row: mealRow,
            weight_saved: true,
            meal_saved: false,
          });
        }

        mealSaved = true;
      }

      return res.status(200).json({
        ok: true,
        grams: weight,
        product_id: product_id || null,
        weight_saved: true,
        meal_saved: mealSaved,
        user_mode: resolvedUser.mode,
        user_id_used: resolvedUser.id || null,
      });
    }

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('weight_log')
        .select('*')
        .order('recorded_at', { ascending: false })
        .limit(1);

      if (error) {
        return res.status(500).json({
          error: 'Failed to read latest weight',
          details: error.message,
        });
      }

      return res.status(200).json({
        ok: true,
        grams: data?.[0]?.weight_g || null,
        row: data?.[0] || null,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('weight endpoint error:', err);
    return res.status(500).json({
      error: 'Internal Server Error',
      details: err?.message || String(err),
    });
  }
}
