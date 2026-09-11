import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

import { mayUsePassword, tenantCanWork } from '../src/lib/auth/guards';
import { requestLoginCode } from '../src/lib/auth/otp';
import { issueSession, resolveSession } from '../src/lib/auth/session';
import { controlDb } from '../src/lib/db/client';

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
    await controlDb().tenant.updateMany({
      where: { id: fixture.get().otherTenantId },
      data: { status: 'active' },
    });
  });

  const suspend = async (): Promise<void> => {
    await controlDb().tenant.update({
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
    const prisma = controlDb();
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
    const prisma = controlDb();
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
    const prisma = controlDb();
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

/**
 * El freno del código por correo era por DIRECCIÓN y solo por dirección: desde
 * una máquina se podían pedir tres códigos para cada una de mil direcciones.
 * Saber si una dirección existe seguía siendo imposible, pero el correo salía
 * igual — así que este servidor servía para llenarle la bandeja al equipo de una
 * oficina y quemar de paso la reputación del dominio que envía.
 */
describe('pedir códigos desde el mismo sitio', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();
  const ip = '203.0.113.9';

  beforeEach(async () => {
    await controlDb().loginCode.deleteMany({});
  });

  // Las cuentas de prueba no se quedan: cuelgan de la oficina raíz, que no se
  // borra entre archivos, y ahí ensuciarían los recuentos de equipo de otros.
  after(async () => {
    await controlDb().user.deleteMany({ where: { email: { startsWith: 'prueba-freno-' } } });
  });

  /** Cuentas de verdad: sin usuario no se escribe fila y no se prueba nada. */
  const cuentas = async (cuantas: number): Promise<string[]> => {
    const prisma = controlDb();
    const correos: string[] = [];
    for (let n = 0; n < cuantas; n += 1) {
      const email = `prueba-freno-${n}@example.com`;
      await prisma.user.upsert({
        where: { email },
        update: {},
        create: { email, memberships: { create: { tenantId: fixture.get().tenantId, role: 'OPERATOR' } } },
      });
      correos.push(email);
    }
    return correos;
  };

  it('un mismo origen no puede recorrer una lista de direcciones', async () => {
    const prisma = controlDb();
    const correos = await cuentas(12);

    for (const email of correos) await requestLoginCode(email, ip);

    // Diez direcciones distintas pasan; de la undécima en adelante, no sale
    // correo. Lo que se cuenta son DIRECCIONES, no códigos.
    const pedidas = await prisma.loginCode.groupBy({ by: ['email'], where: { ip } });
    assert.equal(pedidas.length, 10);
    for (const email of correos.slice(10)) {
      assert.equal(await prisma.loginCode.count({ where: { email } }), 0, `salió código a ${email}`);
    }
  });

  it('pero quien reintenta lo SUYO desde ahí sigue pudiendo', async () => {
    const prisma = controlDb();
    const correos = await cuentas(10);
    for (const email of correos) await requestLoginCode(email, ip);

    // La oficina entera sale por una sola IP. El décimo vuelve a pedir el suyo
    // —se le perdió el correo— y tiene que llegarle: choca contra el freno de su
    // propia dirección, que son tres, no contra el del origen.
    const suyo = correos[9] ?? '';
    await requestLoginCode(suyo, ip);
    assert.equal(await prisma.loginCode.count({ where: { email: suyo } }), 2);

    // Y el suyo sigue teniendo su propio tope.
    await requestLoginCode(suyo, ip);
    await requestLoginCode(suyo, ip);
    assert.equal(await prisma.loginCode.count({ where: { email: suyo } }), 3);
  });
});
