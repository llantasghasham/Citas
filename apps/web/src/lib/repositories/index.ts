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

export type { InvitationRepository };
