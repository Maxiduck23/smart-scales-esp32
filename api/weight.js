import supabase from './_supabase.js';
import { requireDevice } from './_middleware.js';

export default async function handler(req, res) {
  if (req.method === 'POST') {
    if (!requireDevice(req))
      return res.status(401).json({ error: 'Unauthorized' });

    const { grams, product_id } = req.body;

    // Ulož váhu vždy
    await supabase.from('weight_log').insert({ weight_g: grams });

    // Pokud přišel product_id → ulož i jako jídlo
    // Ale bez user_id nemůžeme přiřadit konkrétnímu uživateli
    // Proto ukládáme do weight_log s product_id pro referenci
    if (product_id) {
      await supabase.from('weight_log').update({
        product_id: product_id
      }).order('recorded_at', { ascending: false }).limit(1);
    }

    return res.json({ ok: true });
  }

  if (req.method === 'GET') {
    const { data } = await supabase
      .from('weight_log')
      .select('*')
      .order('recorded_at', { ascending: false })
      .limit(1);
    return res.json({ grams: data[0]?.weight_g || null });
  }
}