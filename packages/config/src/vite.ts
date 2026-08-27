import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type UserConfig } from 'vite';

export interface ReserveFlowViteOptions {
  base?: string;
  port: number;
  /** Dev only. Production serves both bundles from ONE origin (`/` and `/admin/`), so the
   * sign-in page, the session cookie and cross-app redirects all share it. Two Vite servers
   * would split that into two origins and a redirect to `/login` from the admin app would
   * land on a server that does not serve it. Proxying the sibling app restores the single
   * origin locally. HMR for the sibling still comes from its own port. */
  siblingApp?: { path: string; port: number };
}

const sharedEntry = fileURLToPath(new URL('../../shared/src/index.ts', import.meta.url));
const uiEntry = fileURLToPath(new URL('../../ui/src/index.ts', import.meta.url));
const uiTokens = fileURLToPath(new URL('../../ui/src/tokens.css', import.meta.url));

export function createViteConfig({
  base = '/',
  port,
  siblingApp,
}: ReserveFlowViteOptions): UserConfig {
  return defineConfig({
    base,
    build: {
      target: 'es2022',
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: [
        {
          find: /^@reserveflow\/ui\/tokens\.css$/,
          replacement: uiTokens,
        },
        { find: /^@reserveflow\/shared$/, replacement: sharedEntry },
        { find: /^@reserveflow\/ui$/, replacement: uiEntry },
      ],
    },
    server: {
      // Leading dot = any subdomain, so the random tunnel name survives ngrok restarts.
      allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app'],
      port,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3000',
        },
        ...(siblingApp
          ? {
              [siblingApp.path]: {
                target: `http://localhost:${siblingApp.port}`,
                ws: true,
              },
            }
          : {}),
      },
      strictPort: true,
    },
  });
}
