import type { Invitation } from '@/lib/types';

/**
 * How the application reads invitations. The JSON file and PostgreSQL sit behind
 * the same port, so the migration from one to the other never reaches the pages.
 *
 * There is exactly one method, and that is the point: looking a public slug up
 * is the single query this product allows without an office to scope it. A
 * `listAll()` used to live here too, and a page that called it in good faith is
 * how every client's real wedding nearly ended up on the front door. What
 * cannot be reached through this port cannot leak through it.
 */
export interface InvitationRepository {
  /** Public lookup by global slug — the one query with no tenant filter. */
  findBySlug(slug: string): Promise<Invitation | undefined>;
}
