import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '@/generated/prisma/client';

/**
 * One PrismaClient per process. Created lazily so the application still boots
 * without a database while the JSON data source is in use, and cached on
 * globalThis so Next's dev server does not open a new pool on every reload.
 */
const globalForPrisma = globalThis as unknown as { prismaClient?: PrismaClient };

export function getPrisma(): PrismaClient {
  const existing = globalForPrisma.prismaClient;
  if (existing !== undefined) return existing;

  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error('DATABASE_URL is not set. Set it, or use DATA_SOURCE=json.');
  }

  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  globalForPrisma.prismaClient = client;
  return client;
}
