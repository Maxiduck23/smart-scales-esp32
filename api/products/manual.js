import supabase from '../_supabase.js';
import { requireAuth } from '../_middleware.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const user = requireAuth(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { name, calories, protein_g, fat_g, carbs_g, fiber_g, salt_g, barcode, source } = req.body;

    if (!name || !calories) {
        return res.status(400).json({ error: 'Chybí název nebo kalorie' });
    }

    // Pokud existuje produkt se stejným čárovým kódem, vrátíme ho
    if (barcode) {
        const { data: byBarcode } = await supabase
            .from('products')
            .select('*')
            .eq('barcode', barcode)
            .limit(1);
        if (byBarcode?.length) return res.json(byBarcode[0]);
    }

    // Pokud existuje produkt se stejným názvem, vrátíme ho
    const { data: existing } = await supabase
        .from('products')
        .select('*')
        .ilike('name', name.trim())
        .limit(1);

    if (existing?.length) return res.json(existing[0]);

    // Nový produkt
    const { data, error } = await supabase
        .from('products')
        .insert({
            name: name.trim(),
            calories,
            protein_g,
            fat_g,
            carbs_g,
            fiber_g,
            salt_g,
            barcode: barcode || null,
            source: source || 'manual'
        })
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.json(data);
}