import { getAllInvitations, getInvitationBySlug } from '@/lib/invitations';

import type { InvitationRepository } from './types';

/** Reads data/invitations.json. The source of truth until the database is live. */
export const jsonInvitationRepository: InvitationRepository = {
  findBySlug(slug) {
    return Promise.resolve(getInvitationBySlug(slug));
  },
  listAll() {
    return Promise.resolve(getAllInvitations());
  },
};
