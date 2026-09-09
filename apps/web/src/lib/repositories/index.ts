import { cache } from 'react';

import type { Invitation } from '@/lib/types';

import { jsonInvitationRepository } from './json';
import { prismaInvitationRepository } from './prisma';
import type { InvitationRepository } from './types';

/**
 * `DATA_SOURCE=database` reads PostgreSQL; anything else keeps the JSON file.
 * The default is json so the render engine runs with no database at all.
 */
export function getInvitationRepository(): InvitationRepository {
  return process.env['DATA_SOURCE'] === 'database'
    ? prismaInvitationRepository
    : jsonInvitationRepository;
}

/**
 * One lookup per slug per request.
 *
 * `generateMetadata`, the page and the root layout all need the same
 * invitation — the layout to put the right language and direction on `<html>`.
 * Wrapped in React's cache so asking three times is still one query.
 */
export const loadInvitation = cache(
  async (slug: string): Promise<Invitation | undefined> =>
    getInvitationRepository().findBySlug(slug),
);

export type { InvitationRepository };
