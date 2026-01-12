// Development fallback configuration
// In production (Docker), this file is overwritten by docker-entrypoint.sh
// In development (Vite), this provides reasonable defaults

window.__AGENTOPS_CONFIG__ = {
  // Uses Vite proxy in development (/api -> localhost:3200)
  apiUrl: '/api',
  // Inngest dev server URL
  inngestDevUrl: 'http://localhost:8288',
};
