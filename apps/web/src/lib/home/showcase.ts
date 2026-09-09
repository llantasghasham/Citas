import { SITE } from '@/config/site';
import { getInvitationRepository } from '@/lib/repositories';
import type { Invitation } from '@/lib/types';

/**
 * The invitations the public site is allowed to show.
 *
 * Resolved slug by slug from `config/site.ts` rather than listed out of the
 * database: `listAll()` crosses every office, and the front page of a platform
 * whose whole premise is that one office never sees another's data cannot be
 * the one place that shows them all. A slug that no longer exists is simply
 * dropped.
 *
 * One per template comes first, so a heading that promises a celebration tone
 * and a mourning one is not contradicted by three weddings in a row.
 */
export async function loadShowcase(): Promise<Invitation[]> {
  const repository = getInvitationRepository();

  const found = await Promise.all(
    SITE.showcase.map((slug) => repository.findBySlug(slug).catch(() => undefined)),
  );
  const invitations = found.filter((invitation): invitation is Invitation => invitation !== undefined);

  const seen = new Set<string>();
  const firstOfEach = invitations.filter((invitation) => {
    if (seen.has(invitation.templateId)) return false;
    seen.add(invitation.templateId);
    return true;
  });
  const rest = invitations.filter((invitation) => !firstOfEach.includes(invitation));

  return [...firstOfEach, ...rest];
}
