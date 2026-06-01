import supabase from './_supabase.js';
import { requireAuth } from './_middleware.js';

export default async function handler(req, res) {
    const user = requireAuth(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    if (req.method === 'GET') {
        const { data, error } = await supabase
            .from('favorite_products')
            .select(`
                id,
                product_id,
                created_at,
                products (
                    id,
                    name,
                    calories,
                    protein_g,
                    fat_g,
                    carbs_g,
                    fiber_g,
                    image_url
                )
            `)
            .eq('user_id', user.userId)
            .order('created_at', { ascending: false });

        if (error) return res.status(500).json({ error: error.message });

        return res.json({
            favorites: data || []
        });
    }

    if (req.method === 'POST') {
        const { product_id } = req.body || {};

        if (!product_id) {
            return res.status(400).json({ error: 'Missing product_id' });
        }

        const { data, error } = await supabase
            .from('favorite_products')
            .insert({
                user_id: user.userId,
                product_id: product_id
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                return res.status(409).json({ error: 'Already in favorites' });
            }

            return res.status(500).json({ error: error.message });
        }

        return res.json({
            ok: true,
            favorite: data
        });
    }

    if (req.method === 'DELETE') {
        const { product_id } = req.body || {};

        if (!product_id) {
            return res.status(400).json({ error: 'Missing product_id' });
        }

        const { error } = await supabase
            .from('favorite_products')
            .delete()
            .eq('user_id', user.userId)
            .eq('product_id', product_id);

        if (error) return res.status(500).json({ error: error.message });

        return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}