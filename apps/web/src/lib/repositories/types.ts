import type { Invitation } from '@/lib/types';

/**
 * How the application reads invitations. The JSON file and PostgreSQL sit behind
 * the same port, so the migration from one to the other never reaches the pages.
 */
export interface InvitationRepository {
  /** Public lookup by global slug — the one query with no tenant filter. */
  findBySlug(slug: string): Promise<Invitation | undefined>;
  /** Every published invitation. Used to pre-render the example pages. */
  listAll(): Promise<Invitation[]>;
}
