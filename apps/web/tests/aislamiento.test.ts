import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { capabilitiesOf, saveRoleCapabilities, resetRoleCapabilities } from '../src/lib/auth/role-config';
import { controlDb } from '../src/lib/db/client';
import { tenantScope } from '../src/lib/db/tenant';
import { avatarSrc } from '../src/lib/profile/avatar';
import { gatewayUrl } from '../src/lib/whatsapp/gateway';
import {
  cancelScheduled,
  deleteConnection,
  listFailed,
  ownedConnection,
  queueEventInvitations,
  retryFailed,
  setDailyCap,
} from '../src/lib/whatsapp/connections';

import { HAS_DB, makeEvent, withDatabase } from './helpers';

/**
 * Una oficina no ve ni toca lo de otra, ni con el identificador en la mano.
 *
 * Todos los identificadores viajan en campos ocultos de formularios, así que
 * «no salen en pantalla» no protege nada: lo único que protege es que cada
 * consulta lleve su `TenantScope`.
 */
describe('aislamiento entre oficinas', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();

  beforeEach(async () => {
    const prisma = controlDb();
    await prisma.whatsappMessage.deleteMany({});
    await prisma.whatsappConnection.deleteMany({});
    await prisma.guest.deleteMany({ where: { token: { startsWith: 'test-' } } });
    await prisma.event.deleteMany({ where: { venueName: { startsWith: 'Prueba' } } });
  });

  const connectionOfB = async (): Promise<string> => {
    const row = await controlDb().whatsappConnection.create({
      data: {
        tenantId: fixture.get().otherTenantId,
        name: 'El número de B',
        status: 'connected',
        authEnc: 'v1.credenciales-de-B',
      },
    });
    return row.id;
  };

  it('A no resuelve una conexión de B, ni con el id exacto', async () => {
    const id = await connectionOfB();
    assert.equal(await ownedConnection(tenantScope(fixture.get().tenantId), id), null);
  });

  it('A no puede borrar el número de B ni destruirle las credenciales', async () => {
    const id = await connectionOfB();
    assert.equal(await deleteConnection(tenantScope(fixture.get().tenantId), id, fixture.get().userId), false);

    const row = await controlDb().whatsappConnection.findUnique({ where: { id } });
    assert.ok(row !== null, 'la fila sigue');
    assert.equal(row.authEnc, 'v1.credenciales-de-B', 'las credenciales siguen');
  });

  it('A no puede cambiarle el tope diario a B', async () => {
    const id = await connectionOfB();
    await setDailyCap(tenantScope(fixture.get().tenantId), id, 500, fixture.get().userId);
    const row = await controlDb().whatsappConnection.findUniqueOrThrow({ where: { id } });
    assert.equal(row.dailyCap, 200, 'sigue el de fábrica');
  });

  it('A no puede encolar envíos en un evento de B', async () => {
    const id = await connectionOfB();
    const eventOfB = await makeEvent(fixture.get().otherTenantId, [{ name: 'Invitado', phone: '+96170111222' }]);

    const result = await queueEventInvitations(
      tenantScope(fixture.get().tenantId),
      eventOfB,
      id,
      () => 'hola',
      fixture.get().userId,
    );
    assert.deepEqual(result, { error: 'notFound' });
    assert.equal(await controlDb().whatsappMessage.count(), 0);
  });

  it('A no ve ni reintenta los envíos fallidos de B', async () => {
    const id = await connectionOfB();
    const eventOfB = await makeEvent(fixture.get().otherTenantId);
    await controlDb().whatsappMessage.create({
      data: {
        tenantId: fixture.get().otherTenantId,
        connectionId: id,
        eventId: eventOfB,
        toPhone: '+96170111222',
        body: 'x',
        status: 'failed',
        tries: 3,
      },
    });

    assert.deepEqual(await listFailed(tenantScope(fixture.get().tenantId), eventOfB), []);
    assert.equal(await retryFailed(tenantScope(fixture.get().tenantId), eventOfB, fixture.get().userId), 0);
    assert.equal(await cancelScheduled(tenantScope(fixture.get().tenantId), eventOfB, fixture.get().userId), 0);

    // Y B sí los ve.
    assert.equal((await listFailed(tenantScope(fixture.get().otherTenantId), eventOfB)).length, 1);
  });

  it('la base no admite un mensaje de A colgado del número de B', async () => {
    const id = await connectionOfB();
    await assert.rejects(
      controlDb().whatsappMessage.create({
        data: { tenantId: fixture.get().tenantId, connectionId: id, toPhone: '+9', body: 'cruzado' },
      }),
      'la clave foránea compuesta lo impide',
    );
  });
});

describe('los candados de los roles', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();
  void fixture;

  it('no se le puede repartir `platform:manage` a nadie', async () => {
    await saveRoleCapabilities('TENANT_ADMIN', ['tenant:manage', 'platform:manage'], 'prueba');
    const caps = await capabilitiesOf('TENANT_ADMIN');
    assert.ok(!caps.includes('platform:manage'), 'ni escribiéndolo a mano');
    await resetRoleCapabilities('TENANT_ADMIN');
  });

  it('a SUPERADMIN no se le recortan los permisos', async () => {
    await saveRoleCapabilities('SUPERADMIN', ['event:read'], 'prueba');
    const caps = await capabilitiesOf('SUPERADMIN');
    assert.ok(caps.length > 1, 'sigue pudiendo todo');
    assert.ok(caps.includes('platform:manage'));
  });

  it('una fila envenenada escrita a mano tampoco cuela', async () => {
    await controlDb().setting.upsert({
      where: { key: 'ROLE_CAPS_OPERATOR' },
      update: { value: 'platform:manage,event:read,inventado:cosa' },
      create: { key: 'ROLE_CAPS_OPERATOR', value: 'platform:manage,event:read,inventado:cosa' },
    });
    const caps = await capabilitiesOf('OPERATOR');
    assert.deepEqual([...caps], ['event:read']);
    await controlDb().setting.deleteMany({ where: { key: 'ROLE_CAPS_OPERATOR' } });
  });
});

describe('lo que no puede salir hacia fuera', () => {
  it('la dirección del servicio de WhatsApp solo apunta al bucle local', async () => {
    // El guardia va PRIMERO. `controlDb()` lanza si no hay `DATABASE_URL`, así
    // que dejarlo por encima convertía en un fallo lo que tenía que ser un
    // salto: sin base de datos, esta prueba se salta como todas las demás.
    if (!HAS_DB) return;

    const prisma = controlDb();
    const put = async (value: string): Promise<void> => {
      await prisma.setting.upsert({
        where: { key: 'WHATSAPP_GATEWAY_URL' }, update: { value },
        create: { key: 'WHATSAPP_GATEWAY_URL', value },
      });
    };

    for (const bad of [
      'https://evil.example.com',
      'http://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1.evil.example.com',
      'file:///etc/passwd',
      'no es una url',
    ]) {
      await put(bad);
      assert.ok((await gatewayUrl()).refused !== undefined, `debería rechazar ${bad}`);
    }
    for (const good of ['http://127.0.0.1:4100', 'http://localhost:9999']) {
      await put(good);
      assert.equal((await gatewayUrl()).refused, undefined, good);
    }
    await prisma.setting.deleteMany({ where: { key: 'WHATSAPP_GATEWAY_URL' } });
  });

  it('una foto alojada fuera no se dibuja', () => {
    assert.equal(avatarSrc('u', { avatarUrl: 'https://cdn.ajeno.example/yo.png' }), null);
    assert.equal(avatarSrc('u', { avatarUrl: '/api/avatar/u?v=1' }), '/api/avatar/u?v=1');
    assert.equal(avatarSrc('u', { avatarUrl: 'https://ajeno/x', avatarVersion: 'abc' }), '/api/avatar/u?v=abc');
  });
});

/**
 * Lo que impide la BASE, no el código.
 *
 * Llegó por un informe externo y era cierto: la conexión iba por
 * `(id, tenantId)` pero el evento y el invitado eran claves por id a secas, así
 * que que fueran de la misma oficina dependía solo de que el código acertara
 * siempre.
 */
describe('la cadena de oficina de un mensaje', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();

  it('un mensaje no puede colgar del evento de OTRA oficina', async () => {
    const prisma = controlDb();
    const mio = fixture.get().tenantId;
    const ajeno = await makeEvent(fixture.get().otherTenantId, []);
    const conexion = await prisma.whatsappConnection.create({
      data: { tenantId: mio, name: `N-${Math.random().toString(36).slice(2, 8)}`, status: 'connected' },
      select: { id: true },
    });

    await assert.rejects(
      prisma.whatsappMessage.create({
        data: {
          tenantId: mio,
          connectionId: conexion.id,
          // El evento es de la otra oficina. La base no lo admite.
          eventId: ajeno,
          toPhone: '+96170000000',
          body: 'hola',
          status: 'queued',
        },
      }),
      (error: unknown) =>
        // Que lo rechace la CLAVE, no una validación de Prisma: si el mensaje
        // no menciona la restricción, esta prueba estaría pasando por el motivo
        // equivocado y no probaría nada.
        String(error).includes('Foreign key constraint') ||
        String(error).includes('foreign key'),
    );

    await prisma.whatsappConnection.delete({ where: { id: conexion.id } });
    await prisma.event.delete({ where: { id: ajeno } });
  });

  it('ni del invitado de otro evento', async () => {
    const prisma = controlDb();
    const mio = fixture.get().tenantId;
    const uno = await makeEvent(mio, [{ name: 'Ana', phone: null }]);
    const dos = await makeEvent(mio, []);
    const invitado = await prisma.guest.findFirstOrThrow({ where: { eventId: uno } });
    const conexion = await prisma.whatsappConnection.create({
      data: { tenantId: mio, name: `N-${Math.random().toString(36).slice(2, 8)}`, status: 'connected' },
      select: { id: true },
    });

    await assert.rejects(
      prisma.whatsappMessage.create({
        data: {
          tenantId: mio,
          connectionId: conexion.id,
          eventId: dos,
          // El invitado es del evento de al lado.
          guestId: invitado.id,
          toPhone: '+96170000000',
          body: 'hola',
          status: 'queued',
        },
      }),
      (error: unknown) =>
        String(error).includes('Foreign key constraint') || String(error).includes('foreign key'),
    );

    await prisma.whatsappConnection.delete({ where: { id: conexion.id } });
    await prisma.event.deleteMany({ where: { id: { in: [uno, dos] } } });
  });

  it('lo correcto sí entra, y borrar la oficina se lo lleva todo', async () => {
    const prisma = controlDb();
    const tenant = await prisma.tenant.create({
      data: { name: 'Efímera', subdomain: 'prueba-cadena', slug: 'prueba-cadena' },
      select: { id: true },
    });
    const evento = await makeEvent(tenant.id, [{ name: 'Ana', phone: null }]);
    const invitado = await prisma.guest.findFirstOrThrow({ where: { eventId: evento } });
    const conexion = await prisma.whatsappConnection.create({
      data: { tenantId: tenant.id, name: `N-${Math.random().toString(36).slice(2, 8)}`, status: 'connected' },
      select: { id: true },
    });

    await prisma.whatsappMessage.create({
      data: {
        tenantId: tenant.id,
        connectionId: conexion.id,
        eventId: evento,
        guestId: invitado.id,
        toPhone: '+96170000000',
        body: 'hola',
        status: 'queued',
      },
    });

    // Y la cascada sigue funcionando: `NO ACTION` se comprueba al final de la
    // orden, así que evento, invitado y mensaje se van juntos sin tropezar.
    await prisma.tenant.delete({ where: { id: tenant.id } });
    assert.equal(await prisma.whatsappMessage.count({ where: { tenantId: tenant.id } }), 0);
    assert.equal(await prisma.event.count({ where: { id: evento } }), 0);
  });
});
