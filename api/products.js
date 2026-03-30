import supabase from './_supabase.js';
import { requireAuth } from './_middleware.js';

export default async function handler(req, res) {
  try {
    // 1. Ověření uživatele
    const user = requireAuth(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    // 2. Kontrola vyhledávacího dotazu
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Missing query' });

    // 3. Nejprve zkusíme hledat v naší místní databázi
    const { data: local, error: dbError } = await supabase
      .from('products')
      .select('*')
      .ilike('name', `%${q}%`)
      .limit(10);

    if (dbError) throw dbError;

    // Pokud jsme našli výsledky v Supabase, pošleme je a skončíme
    if (local?.length > 0) return res.json(local);

    // 4. Pokud v DB nic není, zeptáme se OpenFoodFacts API
    const response = await fetch(
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&fields=product_name,nutriments,image_front_url,code&page_size=10`
    );

    if (!response.ok) return res.status(502).json({ error: 'Open Food Facts nedostupný' });
    const text = await response.text();
    const data = JSON.parse(text);

    // 5. Zpracování a vyčištění dat z API
    const products = (data.products || [])
      .filter(p => p.nutriments?.['energy-kcal_100g']) // Chceme jen produkty s kalorickou hodnotou
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

    // 6. Uložíme nové produkty do naší DB (cache), aby příště byly k dispozici lokálně
    if (products.length > 0) {
      const { error: upsertError } = await supabase
        .from('products')
        .upsert(products, { onConflict: 'barcode' });

      if (upsertError) {
        console.error('Chyba při ukládání do Supabase:', upsertError.message);
      }
    }

    return res.json(products);

  } catch (error) {
    // Pokud se kdekoli nahoře něco pokazí, skončíme tady
    console.error('Chyba serveru:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      details: error.message
    });
  }
}