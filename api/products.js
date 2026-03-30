import supabase from './_supabase.js';
import { requireAuth } from './_middleware.js';
export default async function handler(req, res) {
  const user = requireAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing query' });
  const { data: local } = await supabase
    .from('products').select('*').ilike('name', `%${q}%`).limit(10);
  if (local?.length > 0) return res.json(local);
  const r = await fetch(`https://cz.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&lc=cs&fields=product_name,nutriments,image_front_url,code&page_size=10`);
  const d = await r.json();
  const products = (d.products || [])
    .filter(p => p.nutriments?.['energy-kcal_100g'])
    .map(p => ({
      name: p.product_name || 'Neznámý produkt',
      barcode: p.code,
      image_url: p.image_front_url || null,
      calories: p.nutriments['energy-kcal_100g'],
      protein_g: p.nutriments['proteins_100g'] || null,
      fat_g: p.nutriments['fat_100g'] || null,
      carbs_g: p.nutriments['carbohydrates_100g'] || null,
      fiber_g: p.nutriments['fiber_100g'] || null,
    }));
  if (products.length > 0)
    await supabase.from('products').upsert(products, { onConflict: 'barcode' });
  return res.json(products);
}