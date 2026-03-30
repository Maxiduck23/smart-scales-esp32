import jwt from 'jsonwebtoken';
export function requireAuth(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
  } catch { return null; }
}
export function requireDevice(req) {
  return req.headers['x-device-key'] === process.env.DEVICE_KEY;
}