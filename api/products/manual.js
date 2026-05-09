import supabase from '../_supabase.js';
import { requireAuth } from '../_middleware.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const user = requireAuth(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { name, calories, protein_g, fat_g, carbs_g, fiber_g, salt_g, barcode, source } = req.body;

    .insert({ name, calories, protein_g, fat_g, carbs_g, fiber_g, salt_g, barcode, source })

    if (!name || !calories) {
        return res.status(400).json({ error: 'Chybí název nebo kalorie' });
    }

    const { data: existing } = await supabase
        .from('products')
        .select('*')
        .ilike('name', name.trim())
        .limit(1);

    if (existing && existing.length) {
        return res.json(existing[0]);
    }

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
            source: source || 'manual'
        })
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.json(data);
}