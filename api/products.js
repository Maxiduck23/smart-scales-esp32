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

export default async function handler(req, res) {
  try {
    const user = requireAuth(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Missing query' });

    // 1. Supabase cache
    const { data: local, error: dbError } = await supabase
      .from('products').select('*').ilike('name', `%${q}%`).limit(10);

    if (dbError) throw dbError;
    if (local?.length > 0) return res.json(local);

    // 2. OpenFoodFacts s retry
    let products = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const response = await fetch(
          `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&fields=product_name,nutriments,image_front_url,code&page_size=10`,
          {
            signal: controller.signal,
            headers: { 'User-Agent': 'SmartScales/1.0 (school project)' }
          }
        );
        clearTimeout(timeout);

        if (response.ok) {
          const d = await response.json();
          products = (d.products || [])
            .filter(p => p.nutriments?.['energy-kcal_100g'])
            .map(p => ({
              name: cleanName(p.product_name),
              barcode: p.code || null,
              image_url: p.image_front_url || null,
              calories: p.nutriments['energy-kcal_100g'],
              protein_g: p.nutriments['proteins_100g'] || null,
              fat_g: p.nutriments['fat_100g'] || null,
              carbs_g: p.nutriments['carbohydrates_100g'] || null,
              fiber_g: p.nutriments['fiber_100g'] || null,
            }));

          if (products.length > 0) {
            const withBarcode = products.filter(p => p.barcode);
            const withoutBarcode = products.filter(p => !p.barcode);

            if (withBarcode.length > 0)
              await supabase.from('products').upsert(withBarcode, { onConflict: 'barcode' });

            for (const p of withoutBarcode) {
              const { data: exists } = await supabase
                .from('products').select('id').ilike('name', p.name).limit(1);
              if (!exists?.length)
                await supabase.from('products').insert(p);
            }
            break; // успех — выходим из retry
          }
        }
      } catch (err) {
        console.error(`Attempt ${attempt} failed:`, err.message);
        if (attempt < 3) await new Promise(r => setTimeout(r, 500));
      }
    }

    return res.json(products);

  } catch (error) {
    console.error('Chyba:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}