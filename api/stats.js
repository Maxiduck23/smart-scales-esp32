import supabase from './_supabase.js';
import { requireAuth } from './_middleware.js';

export default async function handler(req, res) {
    const user = requireAuth(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const days = parseInt(req.query.days) || 7;
    const from = new Date();
    from.setDate(from.getDate() - days);

    const { data: meals, error } = await supabase
        .from('meals')
        .select('weight_g, eaten_at, products(calories, protein_g, fat_g, carbs_g, fiber_g)')
        .eq('user_id', user.userId)
        .gte('eaten_at', from.toISOString())
        .order('eaten_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    // Group by day
    const byDay = {};
    for (const meal of meals || []) {
        const day = meal.eaten_at.split('T')[0];
        if (!byDay[day]) byDay[day] = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, count: 0 };
        const f = meal.weight_g / 100;
        const p = meal.products;
        byDay[day].calories += (p.calories || 0) * f;
        byDay[day].protein += (p.protein_g || 0) * f;
        byDay[day].fat += (p.fat_g || 0) * f;
        byDay[day].carbs += (p.carbs_g || 0) * f;
        byDay[day].fiber += (p.fiber_g || 0) * f;
        byDay[day].count++;
    }

    for (const d of Object.values(byDay)) {
        d.calories = Math.round(d.calories);
        d.protein = Math.round(d.protein);
        d.fat = Math.round(d.fat);
        d.carbs = Math.round(d.carbs);
    }

    return res.json({ days: byDay });
}
