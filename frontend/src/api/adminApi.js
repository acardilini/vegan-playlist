// Shared fetch helper for the admin UI.
// Uses relative /api URLs (the Vite dev proxy forwards them to the backend) and
// always sends the admin password header.
export const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD;

export function adminFetch(path, { method = 'GET', body } = {}) {
  const headers = { 'X-Admin-Password': ADMIN_PASSWORD };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
