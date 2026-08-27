import { Hono } from 'hono';

import { type AuthDependencies, createRequireAuth } from '../../auth/middleware.js';
import { readSettingsDocument, settingsEtag } from '../../lib/settings.js';
import { toBangkokIso } from '../../lib/time.js';

/**
 * Spec §8: the single input for computeSlots()/validateWindow() on the client — settings,
 * the FULL 7-row business_hours set (the calendar feed only returns the weekdays in range),
 * holidays for this year + next, and server_time. ETag'd so the SPA can revalidate cheaply,
 * and PUT /admin/settings If-Match's against the very same ETag.
 */
export function createSettingsRouter(dependencies: AuthDependencies) {
  const pool = dependencies.db.$client;
  const router = new Hono();
  const requireAuth = createRequireAuth(dependencies);

  router.get('/', requireAuth, async (context) => {
    const payload = await readSettingsDocument(pool);
    // server_time stays outside the ETag or no two responses would ever match.
    const etag = settingsEtag(payload);
    context.header('ETag', etag);
    if (context.req.header('if-none-match') === etag) {
      return context.body(null, 304);
    }
    return context.json({ ...payload, server_time: toBangkokIso(new Date()) });
  });

  return router;
}
