import supabase from './_supabase.js';
import { requireAuth } from './_middleware.js';

function normalizeProductId(value) {
    if (value === null || value === undefined) return null;
    const pid = String(value).trim();
    return pid.length ? pid : null;
}

export default async function handler(req, res) {
    try {
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

            if (error) {
                console.error('favorites GET error:', error);
                return res.status(500).json({
                    error: error.message,
                    code: error.code || null
                });
            }

            return res.json({ favorites: data || [] });
        }

        if (req.method === 'POST') {
            const product_id = normalizeProductId(req.body?.product_id);

            if (!product_id) {
                return res.status(400).json({ error: 'Missing product_id' });
            }

            const { data, error } = await supabase
                .from('favorite_products')
                .upsert(
                    {
                        user_id: user.userId,
                        product_id
                    },
                    {
                        onConflict: 'user_id,product_id',
                        ignoreDuplicates: true
                    }
                )
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
                .maybeSingle();

            if (error) {
                console.error('favorites POST error:', error);
                return res.status(500).json({
                    error: error.message,
                    code: error.code || null
                });
            }

            return res.json({
                ok: true,
                favorite: data || null
            });
        }

        if (req.method === 'DELETE') {
            const product_id = normalizeProductId(req.body?.product_id);

            if (!product_id) {
                return res.status(400).json({ error: 'Missing product_id' });
            }

            const { error } = await supabase
                .from('favorite_products')
                .delete()
                .eq('user_id', user.userId)
                .eq('product_id', product_id);

            if (error) {
                console.error('favorites DELETE error:', error);
                return res.status(500).json({
                    error: error.message,
                    code: error.code || null
                });
            }

            return res.json({ ok: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('favorites handler fatal error:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}