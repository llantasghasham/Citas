import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { mayUsePassword, tenantCanWork } from '../src/lib/auth/guards';
import { issueSession, resolveSession } from '../src/lib/auth/session';
import { getPrisma } from '../src/lib/db/client';

import { HAS_DB, withDatabase } from './helpers';

/**
 * Quién puede entrar y quién deja de poder.
 *
 * Las dos cosas de aquí llegaron por un informe externo y las dos eran ciertas:
 * suspender una oficina no suspendía nada, y degradar a un administrador le
 * quitaba los permisos pero le dejaba la contraseña.
 */
describe('quién puede usar contraseña', () => {
  it('el superadministrador y el administrador de oficina, sí', () => {
    assert.equal(mayUsePassword(true, null), true);
    assert.equal(mayUsePassword(false, 'SUPERADMIN'), true);
    assert.equal(mayUsePassword(false, 'TENANT_ADMIN'), true);
  });

  it('un operador o un organizador, no — aunque tenga una puesta de antes', () => {
    // Este es el caso: se puso la contraseña siendo administrador y después se
    // le degradó. Los permisos se le fueron; la contraseña se quedaba.
    assert.equal(mayUsePassword(false, 'OPERATOR'), false);
    assert.equal(mayUsePassword(false, 'ORGANIZER'), false);
    assert.equal(mayUsePassword(false, null), false);
  });
});

describe('una oficina suspendida', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();

  beforeEach(async () => {
    await getPrisma().tenant.updateMany({
      where: { id: fixture.get().otherTenantId },
      data: { status: 'active' },
    });
  });

  const suspend = async (): Promise<void> => {
    await getPrisma().tenant.update({
      where: { id: fixture.get().otherTenantId },
      data: { status: 'suspended' },
    });
  };

  it('no puede trabajar', async () => {
    assert.equal(await tenantCanWork(fixture.get().otherTenantId), true);
    await suspend();
    assert.equal(await tenantCanWork(fixture.get().otherTenantId), false);
  });

  it('sin oficina no hay nada que suspender', async () => {
    assert.equal(await tenantCanWork(null), true);
  });

  it('una sesión YA ABIERTA deja de valer', async () => {
    // Esto es lo que hacía que suspender no suspendiera: una sesión dura
    // treinta días, así que quien ya estaba dentro seguía trabajando hasta que
    // se le ocurriera salir.
    const prisma = getPrisma();
    const user = await prisma.user.create({
      data: {
        email: `suspendido-${Date.now()}@example.com`,
        locale: 'es',
        memberships: { create: { tenantId: fixture.get().otherTenantId, role: 'TENANT_ADMIN' } },
      },
      select: { id: true },
    });
    const token = await issueSession(user.id, fixture.get().otherTenantId);

    assert.notEqual(await resolveSession(token), null, 'antes entraba');
    await suspend();
    assert.equal(await resolveSession(token), null, 'después no');

    await prisma.user.delete({ where: { id: user.id } });
  });

  it('la del superadministrador sigue valiendo: es quien tiene que arreglarlo', async () => {
    const prisma = getPrisma();
    const root = await prisma.user.findFirstOrThrow({
      where: { isSuperadmin: true },
      select: { id: true },
    });
    const token = await issueSession(root.id, fixture.get().otherTenantId);

    await suspend();
    assert.notEqual(await resolveSession(token), null);

    await prisma.session.deleteMany({ where: { userId: root.id, userAgent: null } });
  });

  it('borrar la oficina se lleva sus sesiones', async () => {
    // La clave foránea nueva. Sin ella quedaban filas apuntando a nada, con la
    // IP y el navegador de quien entró dentro.
    const prisma = getPrisma();
    const tenant = await prisma.tenant.create({
      data: { name: 'Efímera', subdomain: 'prueba-efimera', slug: 'prueba-efimera' },
      select: { id: true },
    });
    const user = await prisma.user.findFirstOrThrow({ where: { isSuperadmin: true } });
    await issueSession(user.id, tenant.id);

    assert.equal(await prisma.session.count({ where: { tenantId: tenant.id } }), 1);
    await prisma.tenant.delete({ where: { id: tenant.id } });
    assert.equal(await prisma.session.count({ where: { tenantId: tenant.id } }), 0);
  });
});
