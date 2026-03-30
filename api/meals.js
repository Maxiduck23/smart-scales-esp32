// Zpracování denního příjmu jídla
const supabase = require('./_supabase');
const { requireAuth } = require('./_middleware');

module.exports = async function handler(req, res) {
    // Ověření JWT tokenu
    const user = requireAuth(req);
    if (!user) return res.status(401).json({ error: 'Nejste přihlášeni' });

    // GET → vrátí dnešní jídla uživatele
    if (req.method === 'GET') {
        const dnes = new Date().toISOString().split('T')[0]; // např. "2026-03-30"

        const { data, error } = await supabase
            .from('meals')
            .select(`
        id,
        weight_g,
        meal_type,
        eaten_at,
        products (
          name,
          image_url,
          calories,
          protein_g,
          fat_g,
          carbs_g,
          fiber_g
        )
      `)
            .eq('user_id', user.userId)
            .gte('eaten_at', `${dnes}T00:00:00`)
            .lte('eaten_at', `${dnes}T23:59:59`)
            .order('eaten_at', { ascending: false });

        if (error) return res.status(500).json({ error: error.message });

        // Spočítáme celkový příjem za den
        const totals = (data || []).reduce((acc, meal) => {
            const p = meal.products;
            const f = meal.weight_g / 100; // přepočet na skutečnou gramáž
            return {
                calories: acc.calories + (p.calories || 0) * f,
                protein: acc.protein + (p.protein_g || 0) * f,
                fat: acc.fat + (p.fat_g || 0) * f,
                carbs: acc.carbs + (p.carbs_g || 0) * f,
                fiber: acc.fiber + (p.fiber_g || 0) * f,
            };
        }, { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 });

        return res.json({ meals: data, totals });
    }

    // POST → přidá nové jídlo
    if (req.method === 'POST') {
        const { product_id, weight_g, meal_type } = req.body;

        if (!product_id || !weight_g) {
            return res.status(400).json({ error: 'Chybí product_id nebo weight_g' });
        }

        const { data, error } = await supabase
            .from('meals')
            .insert({
                user_id: user.userId,
                product_id,
                weight_g,
                meal_type: meal_type || 'snack'
            })
            .select()
            .single();

        if (error) return res.status(500).json({ error: error.message });
        return res.json(data);
    }

    // DELETE → smaže jídlo
    if (req.method === 'DELETE') {
        const { meal_id } = req.body;

        await supabase
            .from('meals')
            .delete()
            .eq('id', meal_id)
            .eq('user_id', user.userId); // bezpečnost: jen vlastní jídla

        return res.json({ ok: true });
    }
};