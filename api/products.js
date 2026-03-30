import supabase from './_supabase.js';
import { requireAuth } from './_middleware.js';

export default async function handler(req, res) {
  try {
    const user = requireAuth(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Missing query' });

    // 1. Hledání v Supabase cache
    const { data: local, error: dbError } = await supabase
      .from('products')
      .select('*')
      .ilike('name', `%${q}%`)
      .limit(10);

    if (dbError) throw dbError;
    if (local?.length > 0) return res.json(local);

    // 2. OpenFoodFacts s timeoutem 5s
    let products = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000); // Zvýšeno na 8s

        const response = await fetch(
          `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&fields=product_name,nutriments,image_front_url,code&page_size=10`,
          {

            signal: controller.signal,
            headers: { 'User-Agent': 'SmartScales/1.0 (school project; tvuj@email.cz)' }
          }
        );

        clearTimeout(timeout);

        if (response.ok) {
          const d = await response.json();
          const items = (d.products || [])
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
          const products = (d.products || [])
            .filter(p => p.nutriments?.['energy-kcal_100g'])
            .map(p => ({
              name: (p.product_name || 'Neznámý produkt')
                .replace(/&quot;/gi, '')
                .replace(/&amp;/gi, '&')
                .replace(/&lt;/gi, '<')
                .replace(/&gt;/gi, '>')
                .replace(/\s+/g, ' ')
                .trim(),
            }));
          const withBarcode = products.filter(p => p.barcode);
          const withoutBarcode = products.filter(p => !p.barcode);

          // С штрихкодом — upsert как обычно
          if (withBarcode.length > 0)
            await supabase.from('products').upsert(withBarcode, { onConflict: 'barcode' });

          // Без штрихкода — только если такого названия ещё нет
          for (const p of withoutBarcode) {
            const { data: exists } = await supabase
              .from('products')
              .select('id')
              .ilike('name', p.name)
              .limit(1);
            if (!exists?.length)
              await supabase.from('products').insert(p);
          }
        }
      } catch (err) {
        console.error(`Attempt ${attempt} failed:`, err.message);
        // Počkáme chvíli před dalším pokusem (např. 500ms), aby si API oddechlo
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return res.json(products);

  } catch (error) {
    console.error('Chyba:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}