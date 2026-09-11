import { cache } from 'react';

import { controlDb } from '@/lib/db/client';

export interface CurrentTenant {
  id: string;
  slug: string;
  name: string;
  isRoot: boolean;
  defaultLocale: string;
}

/**
 * Which office the request is addressed to, taken from the host: an office works
 * at `agenciax.dominio.com` or at its own domain.
 *
 * The lookup happens here rather than in middleware on purpose: middleware runs
 * on the edge runtime, where the PostgreSQL driver cannot.
 */
function subdomainOf(host: string): string | undefined {
  const hostname = host.split(':')[0] ?? '';
  const labels = hostname.split('.');
  // `agenciax.localhost` in development, `agenciax.dominio.com` in production.
  const isLocal = labels.at(-1) === 'localhost';
  const minimumLabels = isLocal ? 2 : 3;
  if (labels.length < minimumLabels) return undefined;
  return labels[0];
}

export const getTenantById = cache(async (id: string): Promise<CurrentTenant | null> => {
  return controlDb().tenant.findUnique({ where: { id } });
});

export const getTenantByHost = cache(async (host: string): Promise<CurrentTenant | null> => {
  const prisma = controlDb();
  const hostname = host.split(':')[0] ?? '';

  const byDomain = await prisma.tenant.findUnique({ where: { customDomain: hostname } });
  if (byDomain !== null) return byDomain;

  const subdomain = subdomainOf(host);
  if (subdomain === undefined) return null;

  return prisma.tenant.findUnique({ where: { subdomain } });
});
