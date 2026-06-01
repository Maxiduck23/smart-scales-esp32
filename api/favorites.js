import supabase from './_supabase.js';
import { requireAuth } from './_middleware.js';

function normalizeProductId(value) {
    if (value === null || value === undefined) return null;
    const pid = String(value).trim();
    return pid.length ? pid : null;
}

async function attachProductsToFavorites(favorites) {
    if (!favorites || favorites.length === 0) return [];

    const productIds = [...new Set(
        favorites
            .map(f => String(f.product_id))
            .filter(Boolean)
    )];

    if (productIds.length === 0) {
        return favorites.map(f => ({ ...f, products: null }));
    }

    const { data: products, error: productError } = await supabase
        .from('products')
        .select('id, name, calories, protein_g, fat_g, carbs_g, fiber_g, image_url')
        .in('id', productIds);

    if (productError) {
        console.error('favorites products fetch error:', productError);
        throw productError;
    }

    const productMap = {};
    for (const p of products || []) {
        productMap[String(p.id)] = p;
    }

    return favorites.map(f => ({
        ...f,
        products: productMap[String(f.product_id)] || null
    }));
}

export default async function handler(req, res) {
    try {
        const user = requireAuth(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        if (req.method === 'GET') {
            const { data: favorites, error } = await supabase
                .from('favorite_products')
                .select('id, product_id, created_at')
                .eq('user_id', user.userId)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('favorites GET error:', error);
                return res.status(500).json({
                    error: error.message,
                    code: error.code || null,
                    details: error.details || null,
                    hint: error.hint || null
                });
            }

            const result = await attachProductsToFavorites(favorites || []);
            return res.json({ favorites: result });
        }

        if (req.method === 'POST') {
            const product_id = normalizeProductId(req.body?.product_id);

            if (!product_id) {
                return res.status(400).json({ error: 'Missing product_id' });
            }

            // Check duplicate manually instead of upsert.
            // This avoids onConflict/schema-cache problems.
            const { data: existing, error: existingError } = await supabase
                .from('favorite_products')
                .select('id, product_id, created_at')
                .eq('user_id', user.userId)
                .eq('product_id', product_id)
                .maybeSingle();

            if (existingError) {
                console.error('favorites duplicate check error:', existingError);
                return res.status(500).json({
                    error: existingError.message,
                    code: existingError.code || null,
                    details: existingError.details || null,
                    hint: existingError.hint || null
                });
            }

            if (existing) {
                const withProduct = await attachProductsToFavorites([existing]);
                return res.json({
                    ok: true,
                    already_exists: true,
                    favorite: withProduct[0] || existing
                });
            }

            const { data: inserted, error: insertError } = await supabase
                .from('favorite_products')
                .insert({
                    user_id: user.userId,
                    product_id
                })
                .select('id, product_id, created_at')
                .single();

            if (insertError) {
                console.error('favorites POST error:', insertError);
                return res.status(500).json({
                    error: insertError.message,
                    code: insertError.code || null,
                    details: insertError.details || null,
                    hint: insertError.hint || null
                });
            }

            const withProduct = await attachProductsToFavorites([inserted]);

            return res.json({
                ok: true,
                favorite: withProduct[0] || inserted
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
                    code: error.code || null,
                    details: error.details || null,
                    hint: error.hint || null
                });
            }

            return res.json({ ok: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('favorites handler fatal error:', err);
        return res.status(500).json({
            error: err.message || 'Internal Server Error',
            code: err.code || null,
            details: err.details || null,
            hint: err.hint || null
        });
    }
}