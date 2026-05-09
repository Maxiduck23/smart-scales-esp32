// Vrátí posledně přidaná jídla uživatele pro výběr na váze
import supabase from '../_supabase.js';
import { requireDevice } from '../_middleware.js';

export default async function handler(req, res) {
    // ESP32 se autentizuje device key, ne JWT
    if (!requireDevice(req))
        return res.status(401).json({ error: 'Unauthorized' });

    if (req.method !== 'GET')
        return res.status(405).end();

    // Vezmi posledních 10 unikátních produktů ze všech jídel
    const { data, error } = await supabase
        .from('meals')
        .select('products(id, name, calories)')
        .order('eaten_at', { ascending: false })
        .limit(50);

    if (error) return res.status(500).json({ error: error.message });

    // Deduplikuj — každý produkt jen jednou
    const seen = new Set();
    const unique = [];
    for (const meal of data || []) {
        const p = meal.products;
        if (p && !seen.has(p.id)) {
            seen.add(p.id);
            unique.push({ id: p.id, name: p.name, calories: p.calories });
            if (unique.length >= 10) break;
        }
    }

    return res.json(unique);
}