import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { getPrisma } from '../src/lib/db/client';
import { tenantScope } from '../src/lib/db/tenant';
import {
  addTable,
  autoSeat,
  clearSeating,
  readSeating,
  removeTable,
  seatGuest,
} from '../src/lib/tables/service';

import { HAS_DB, makeEvent, withDatabase } from './helpers';

/**
 * El reparto del salón.
 *
 * Lo que se prueba aquí es sobre todo lo que hace la BASE: la clave foránea
 * compuesta que impide sentar a un invitado en la mesa de otra boda, el índice
 * único que impide dos «Mesa 1» en la misma, y el `ON DELETE SET NULL` que al
 * quitar una mesa levanta a quien estaba en ella sin borrar a nadie. Contra un
 * doble, las tres darían verde estando rotas.
 */
describe('las mesas', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();

  beforeEach(async () => {
    const prisma = getPrisma();
    await prisma.rsvp.deleteMany({});
    // Levantar antes de quitar las mesas: la clave foránea no admite que quede
    // un invitado apuntando a una mesa que ya no está, y eso es lo que se
    // quiere. Aquí se nota porque la limpieza también tiene que respetarlo.
    await prisma.guest.updateMany({ where: { tableId: { not: null } }, data: { tableId: null } });
    await prisma.table.deleteMany({});
    await prisma.guest.deleteMany({ where: { token: { startsWith: 'test-' } } });
    await prisma.event.deleteMany({ where: { venueName: { startsWith: 'Prueba' } } });
  });

  const scope = (): ReturnType<typeof tenantScope> => tenantScope(fixture.get().tenantId);

  /** Confirma a un invitado por `party` personas, él incluido. */
  const confirm = async (guestId: string, party: number): Promise<void> => {
    await getPrisma().rsvp.create({ data: { guestId, status: 'attending', party } });
  };

  const guestsOf = async (eventId: string): Promise<{ id: string; name: string }[]> =>
    getPrisma().guest.findMany({ where: { eventId }, orderBy: { name: 'asc' }, select: { id: true, name: true } });

  it('quien no ha contestado no ocupa silla', async () => {
    const eventId = await makeEvent(fixture.get().tenantId, [
      { name: 'Ana', phone: null },
      { name: 'Beto', phone: null },
    ]);
    const [ana] = await guestsOf(eventId);
    await confirm(ana!.id, 1);

    const seating = await readSeating(scope(), eventId);
    assert.equal(seating?.needed, 1, 'solo Ana cuenta');
    assert.equal(seating?.unseated.length, 1);
    assert.equal(seating?.unseated[0]?.name, 'Ana');
  });

  it('quien confirmó por cuatro ocupa cuatro sillas, no una', async () => {
    const eventId = await makeEvent(fixture.get().tenantId, [{ name: 'Ana', phone: null }]);
    const [ana] = await guestsOf(eventId);
    await confirm(ana!.id, 4);

    const seating = await readSeating(scope(), eventId);
    assert.equal(seating?.needed, 4);
    assert.equal(seating?.unseated[0]?.seats, 4);
  });

  it('sentar a alguien en la mesa de OTRA boda es imposible', async () => {
    const mine = await makeEvent(fixture.get().tenantId, [{ name: 'Ana', phone: null }]);
    const theirs = await makeEvent(fixture.get().tenantId, []);
    await addTable(scope(), theirs, 'Mesa ajena', 10, 'Mesa');

    const table = await getPrisma().table.findFirstOrThrow({ where: { eventId: theirs } });
    const [ana] = await guestsOf(mine);

    // Por la puerta de delante: el servicio dice que no.
    assert.equal(await seatGuest(scope(), mine, ana!.id, table.id), 'notFound');

    // Y por detrás tampoco: la clave foránea compuesta lleva el evento dentro.
    await assert.rejects(
      getPrisma().guest.update({ where: { id: ana!.id }, data: { tableId: table.id } }),
    );
  });

  it('quitar la mesa levanta a los que estaban, no los borra', async () => {
    const eventId = await makeEvent(fixture.get().tenantId, [{ name: 'Ana', phone: null }]);
    const [ana] = await guestsOf(eventId);
    await confirm(ana!.id, 2);
    await addTable(scope(), eventId, 'Mesa 1', 10, 'Mesa');
    const table = await getPrisma().table.findFirstOrThrow({ where: { eventId } });
    await seatGuest(scope(), eventId, ana!.id, table.id);

    await removeTable(scope(), eventId, table.id);

    const after = await getPrisma().guest.findUniqueOrThrow({ where: { id: ana!.id } });
    assert.equal(after.tableId, null, 'sin mesa');
    assert.equal(after.name, 'Ana', 'el invitado sigue ahí');
  });

  it('dos mesas con el mismo nombre en la misma boda, no; en dos bodas, sí', async () => {
    const uno = await makeEvent(fixture.get().tenantId, []);
    const dos = await makeEvent(fixture.get().tenantId, []);

    assert.equal(await addTable(scope(), uno, 'Mesa 1', 10, 'Mesa'), 'ok');
    assert.equal(await addTable(scope(), uno, 'Mesa 1', 10, 'Mesa'), 'duplicate');
    assert.equal(await addTable(scope(), dos, 'Mesa 1', 10, 'Mesa'), 'ok');
  });

  it('una mesa sin nombre se nombra sola y no choca', async () => {
    const eventId = await makeEvent(fixture.get().tenantId, []);
    await addTable(scope(), eventId, '', 10, 'Mesa');
    await addTable(scope(), eventId, '   ', 10, 'Mesa');

    const names = (
      await getPrisma().table.findMany({ where: { eventId }, orderBy: { position: 'asc' } })
    ).map((table) => table.name);
    assert.deepEqual(names, ['Mesa 1', 'Mesa 2']);
  });

  it('el reparto automático no parte un grupo', async () => {
    const eventId = await makeEvent(fixture.get().tenantId, [
      { name: 'Ana', phone: null },
      { name: 'Beto', phone: null },
    ]);
    const [ana, beto] = await guestsOf(eventId);
    await confirm(ana!.id, 4);
    await confirm(beto!.id, 3);
    // Una mesa de cinco: cabe uno de los dos grupos, nunca los dos ni medio.
    await addTable(scope(), eventId, 'Mesa 1', 5, 'Mesa');

    assert.equal(await autoSeat(scope(), eventId), 1);

    const seating = await readSeating(scope(), eventId);
    assert.equal(seating?.tables[0]?.taken, 4, 'entró el grupo grande entero');
    assert.equal(seating?.unseated.length, 1);
    assert.equal(seating?.unseated[0]?.name, 'Beto');
  });

  it('el reparto automático no se pasa de plazas', async () => {
    const eventId = await makeEvent(fixture.get().tenantId, [
      { name: 'Ana', phone: null },
      { name: 'Beto', phone: null },
      { name: 'Carla', phone: null },
    ]);
    for (const guest of await guestsOf(eventId)) await confirm(guest.id, 2);
    await addTable(scope(), eventId, 'Mesa 1', 4, 'Mesa');
    await addTable(scope(), eventId, 'Mesa 2', 4, 'Mesa');

    assert.equal(await autoSeat(scope(), eventId), 3);

    const seating = await readSeating(scope(), eventId);
    for (const table of seating?.tables ?? []) {
      assert.ok(table.taken <= table.seats, `${table.name} se pasó`);
    }
    assert.equal(seating?.unseated.length, 0);
  });

  it('quien se sentó y luego dijo que no viene sigue en su mesa, señalado', async () => {
    const eventId = await makeEvent(fixture.get().tenantId, [{ name: 'Ana', phone: null }]);
    const [ana] = await guestsOf(eventId);
    await confirm(ana!.id, 2);
    await addTable(scope(), eventId, 'Mesa 1', 10, 'Mesa');
    const table = await getPrisma().table.findFirstOrThrow({ where: { eventId } });
    await seatGuest(scope(), eventId, ana!.id, table.id);

    // Cambia de idea. Nadie la levanta: eso lo decide una persona.
    await getPrisma().rsvp.update({ where: { guestId: ana!.id }, data: { status: 'declined' } });

    const seating = await readSeating(scope(), eventId);
    assert.equal(seating?.tables[0]?.guests.length, 1, 'sigue sentada');
    assert.equal(seating?.tables[0]?.taken, 0, 'pero no ocupa silla');
    assert.equal(seating?.tables[0]?.ghosts, 1, 'y se avisa');
  });

  it('levantar a todos no borra a nadie', async () => {
    const eventId = await makeEvent(fixture.get().tenantId, [
      { name: 'Ana', phone: null },
      { name: 'Beto', phone: null },
    ]);
    for (const guest of await guestsOf(eventId)) await confirm(guest.id, 1);
    await addTable(scope(), eventId, 'Mesa 1', 10, 'Mesa');
    await autoSeat(scope(), eventId);

    assert.equal(await clearSeating(scope(), eventId), 2);
    assert.equal((await guestsOf(eventId)).length, 2);
    assert.equal((await readSeating(scope(), eventId))?.unseated.length, 2);
  });

  it('borrar la boda entera se lleva las mesas y no tropieza con la clave', async () => {
    // La clave de Guest→Table es `NO ACTION`, que se comprueba al FINAL de la
    // orden. Con `RESTRICT` esto fallaría, y una boda con el salón repartido se
    // habría vuelto imposible de borrar.
    const eventId = await makeEvent(fixture.get().tenantId, [{ name: 'Ana', phone: null }]);
    const [ana] = await guestsOf(eventId);
    await confirm(ana!.id, 2);
    await addTable(scope(), eventId, 'Mesa 1', 10, 'Mesa');
    await autoSeat(scope(), eventId);

    await getPrisma().event.delete({ where: { id: eventId } });

    assert.equal(await getPrisma().table.count({ where: { eventId } }), 0);
    assert.equal(await getPrisma().guest.count({ where: { eventId } }), 0);
  });

  it('otra oficina no ve ni toca estas mesas', async () => {
    const eventId = await makeEvent(fixture.get().tenantId, [{ name: 'Ana', phone: null }]);
    await addTable(scope(), eventId, 'Mesa 1', 10, 'Mesa');
    const table = await getPrisma().table.findFirstOrThrow({ where: { eventId } });
    const [ana] = await guestsOf(eventId);

    const intruder = tenantScope(fixture.get().otherTenantId);
    assert.equal(await readSeating(intruder, eventId), null);
    assert.equal(await addTable(intruder, eventId, 'Suya', 10, 'Mesa'), 'notFound');
    assert.equal(await removeTable(intruder, eventId, table.id), 'notFound');
    assert.equal(await seatGuest(intruder, eventId, ana!.id, table.id), 'notFound');
    assert.equal(await autoSeat(intruder, eventId), 0);
    assert.equal(await clearSeating(intruder, eventId), 0);

    // Y nada de eso escribió nada.
    assert.equal(await getPrisma().table.count({ where: { eventId } }), 1);
  });
});
