import { createViteConfig } from '@reserveflow/config/vite';

// The admin bundle is proxied in so local dev has the same single origin as production:
// one place to sign in, one cookie, working cross-app redirects.
export default createViteConfig({
  port: 5173,
  siblingApp: { path: '/admin', port: 5174 },
});
