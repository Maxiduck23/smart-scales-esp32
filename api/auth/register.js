import supabase from '../_supabase.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { email, password, name } = req.body;

  const hash = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from('users')
    .insert({ email, password: hash, name })
    .select()
    .single();

  if (error) return res.status(400).json({ error: 'Email již existuje' });

  const token = jwt.sign(
    { userId: data.id, email: data.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({ token, name: data.name });
}