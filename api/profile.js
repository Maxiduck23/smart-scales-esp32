import supabase from './_supabase.js';
import { requireAuth } from './_middleware.js';

export default async function handler(req, res) {
    const user = requireAuth(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    if (req.method === 'GET') {
        const { data } = await supabase
            .from('users')
            .select('name,email,birth_year,height_cm,weight_kg,goal_weight_kg,goal,activity')
            .eq('id', user.userId)
            .single();
        return res.json(data || {});
    }

    if (req.method === 'PATCH') {
        const { birth_year, height_cm, weight_kg, goal_weight_kg, goal, activity } = req.body;
        const { data, error } = await supabase
            .from('users')
            .update({ birth_year, height_cm, weight_kg, goal_weight_kg, goal, activity })
            .eq('id', user.userId)
            .select()
            .single();
        if (error) return res.status(500).json({ error: error.message });
        return res.json(data);
    }

    return res.status(405).end();
}