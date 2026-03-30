import supabase from './_supabase.js';
import { requireAuth } from './_middleware.js';

export default async function handler(req, res) {
  try {
    // 1. Ověření uživatele
    const user = requireAuth(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    // 2. Kontrola dotazu - v app.js posíláš ?q=...
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Missing query' });

    // 3. Hledání v místní DB (Supabase)
    const { data: local, error: dbError } = await supabase
      .from('products')
      .select('*')
      .ilike('name', `%${q}%`)
      .limit(10);

    if (dbError) throw dbError;
    if (local?.length > 0) return res.json(local);

    // 4. Volání OpenFoodFacts API
    const response = await fetch(
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&fields=product_name,nutriments,image_front_url,code&page_size=10`,
      {
        headers: {
          'User-Agent': 'SmartScales/1.0 (school project; polyvodamaksym@gmail.com)'
        }
      }
    );

    console.log('OFF status:', response.status);
    if (!response.ok) return res.status(502).json({ error: 'API nedostupné', status: response.status });

    const d = await response.json();

    // 5. Zpracování dat - použito 'p' pro iteraci
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

    // 6. Uložení do Supabase cache
    if (products.length > 0) {
      await supabase.from('products').upsert(products, { onConflict: 'barcode' });
    }

    return res.json(products);

  } catch (error) {
    console.error('Chyba:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
} 