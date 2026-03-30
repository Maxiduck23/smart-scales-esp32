import supabase from '../_supabase.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { email, password } = req.body;

  const { data: users } = await supabase
    .from('users').select('*').eq('email', email).limit(1);

  if (!users?.length)
    return res.status(401).json({ error: 'Nesprávný email nebo heslo' });

  const valid = await bcrypt.compare(password, users[0].password);
  if (!valid)
    return res.status(401).json({ error: 'Nesprávný email nebo heslo' });

  const token = jwt.sign(
    { userId: users[0].id, email: users[0].email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({ token, name: users[0].name });
}