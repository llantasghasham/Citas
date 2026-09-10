import type { Locale, PlanTier, Role, TenantStatus } from '@/generated/prisma/enums';
import { getPrisma } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';
import { avatarSrc } from '@/lib/profile/avatar';

export interface OfficeRow {
  id: string;
  name: string;
  subdomain: string;
  status: TenantStatus;
  isRoot: boolean;
  tier: PlanTier | null;
  events: number;
}

/** Offices are platform-wide, so only a superadmin ever calls this. */
export async function listOffices(): Promise<OfficeRow[]> {
  const tenants = await getPrisma().tenant.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      subscription: { include: { plan: true } },
      _count: { select: { events: true } },
    },
  });

  return tenants.map((tenant) => ({
    id: tenant.id,
    name: tenant.name,
    subdomain: tenant.subdomain,
    status: tenant.status,
    isRoot: tenant.isRoot,
    tier: tenant.subscription?.plan.tier ?? null,
    events: tenant._count.events,
  }));
}

export interface CreateOfficeInput {
  name: string;
  subdomain: string;
  defaultLocale: Locale;
  tier: PlanTier;
}

const SUBDOMAIN_SHAPE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;

export function normalizeSubdomain(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidSubdomain(value: string): boolean {
  return SUBDOMAIN_SHAPE.test(value);
}

export async function createOffice(input: CreateOfficeInput): Promise<string | null> {
  if (!isValidSubdomain(input.subdomain) || input.name.length === 0) return null;

  const prisma = getPrisma();
  const taken = await prisma.tenant.findFirst({
    where: { OR: [{ subdomain: input.subdomain }, { slug: input.subdomain }] },
    select: { id: true },
  });
  if (taken !== null) return null;

  const plan = await prisma.plan.findUnique({ where: { tier: input.tier } });

  const tenant = await prisma.tenant.create({
    data: {
      slug: input.subdomain,
      subdomain: input.subdomain,
      name: input.name,
      defaultLocale: input.defaultLocale,
      status: 'trial',
      ...(plan === null ? {} : { subscription: { create: { planId: plan.id } } }),
    },
    select: { id: true },
  });

  return tenant.id;
}

export interface MemberRow {
  userId: string;
  email: string;
  role: Role;
  name: string | null;
  locale: Locale;
  /** El país que maneja: ISO alfa-2, o nulo si no ha elegido. */
  country: string | null;
  /** La dirección de su foto, subida o de fuera, ya resuelta. */
  avatarUrl: string | null;
}

export async function listMembers(scope: TenantScope): Promise<MemberRow[]> {
  const memberships = await getPrisma().membership.findMany({
    where: scopedWhere(scope),
    orderBy: { createdAt: 'asc' },
    include: {
      user: {
        select: {
          email: true,
          name: true,
          locale: true,
          country: true,
          avatarUrl: true,
          avatarVersion: true,
        },
      },
    },
  });

  return memberships.map((membership) => ({
    userId: membership.userId,
    email: membership.user.email,
    role: membership.role,
    name: membership.user.name,
    locale: membership.user.locale,
    country: membership.user.country,
    avatarUrl: avatarSrc(membership.userId, membership.user),
  }));
}

/**
 * Cambia el rol, el idioma o el país de alguien del equipo.
 *
 * Se resuelve la pertenencia CON el `TenantScope` antes de tocar nada: el id
 * viaja en el formulario, así que sin esa comprobación quien tuviera sesión
 * podría cambiarle el rol a alguien de otra oficina.
 *
 * No se deja poner SUPERADMIN: ese rol no sale de una membresía, sale de
 * `User.isSuperadmin`, y ofrecerlo aquí sería ofrecer la llave de la casa.
 */
export async function updateMember(
  scope: TenantScope,
  userId: string,
  changes: { role?: Role; locale?: Locale; country?: string | null },
): Promise<boolean> {
  const prisma = getPrisma();
  const membership = await prisma.membership.findFirst({
    where: { userId, ...scopedWhere(scope) },
    select: { id: true },
  });
  if (membership === null) return false;

  if (changes.role !== undefined && changes.role !== 'SUPERADMIN') {
    await prisma.membership.update({ where: { id: membership.id }, data: { role: changes.role } });
  }

  const userData: { locale?: Locale; country?: string | null } = {};
  if (changes.locale !== undefined) userData.locale = changes.locale;
  if (changes.country !== undefined) userData.country = changes.country;
  if (Object.keys(userData).length > 0) {
    await prisma.user.update({ where: { id: userId }, data: userData });
  }

  return true;
}

/**
 * Adds someone to the office. No invitation email and no password: the account
 * exists, and they get in with a one-time code whenever they first try.
 */
export async function addMember(
  scope: TenantScope,
  email: string,
  role: Role,
): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0 || !normalized.includes('@')) return false;

  const prisma = getPrisma();
  const user = await prisma.user.upsert({
    where: { email: normalized },
    update: {},
    create: { email: normalized },
    select: { id: true },
  });

  await prisma.membership.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId: scope.tenantId } },
    update: { role },
    create: { userId: user.id, tenantId: scope.tenantId, role },
  });

  return true;
}
