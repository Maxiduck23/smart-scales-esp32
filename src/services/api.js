const BASE = '/api';
const getToken = () => localStorage.getItem('token');
export const saveToken = t => localStorage.setItem('token', t);
export const logout = () => { localStorage.removeItem('token'); location.href = '/login'; };
export async function apiRequest(path, options = {}) {
  const res = await fetch(`${BASE}/${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}`, ...options.headers }
  });
  if (res.status === 401) { logout(); return null; }
  return res.json();
}