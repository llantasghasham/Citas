import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { getPrisma } from '../src/lib/db/client';
import { newPayCode } from '../src/lib/payments/sinpe/code';
import { ingestSinpeEmail, tryMatch } from '../src/lib/payments/sinpe/service';

import { HAS_DB, withDatabase } from './helpers';

/**
 * Casar un SINPE con un cobro.
 *
 * Contra PostgreSQL de verdad porque lo que se prueba lo hace la base: el
 * comprobante único por cuenta, que es lo que impide cobrar dos veces el mismo
 * correo, y el `providerRef` único por proveedor, que es la segunda red por si
 * fallara la primera.
 */
describe('el cobro por SINPE', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();

  beforeEach(async () => {
    const prisma = getPrisma();
    await prisma.sinpeMovement.deleteMany({});
    await prisma.sinpeAccount.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.order.deleteMany({});
  });

  /** El buzón de la plataforma: sin oficina, que es la fase 1. */
  const account = async (tenantId: string | null = null): Promise<{ id: string; tenantId: string | null }> => {
    const row = await getPrisma().sinpeAccount.create({
      data: {
        tenantId,
        name: 'Buzón de prueba',
        bank: 'bac',
        phone: '+50688887777',
        imapHost: 'imap.example.com',
        imapUser: 'cobros@example.com',
        imapPasswordEnc: 'v1.no-es-una-contraseña',
      },
      select: { id: true, tenantId: true },
    });
    return row;
  };

  const order = async (amount: number, tenantId?: string): Promise<{ id: string; payCode: string }> => {
    const row = await getPrisma().order.create({
      data: {
        tenantId: tenantId ?? fixture.get().tenantId,
        amount,
        currency: 'CRC',
        description: 'Plan Oficina',
        status: 'pending',
        payCode: newPayCode(),
      },
      select: { id: true, payCode: true },
    });
    return { id: row.id, payCode: row.payCode ?? '' };
  };

  const aviso = (monto: string, comprobante: string, codigo: string): string =>
    `Ha recibido un SINPE Móvil de ANA SOLIS por ₡${monto}. ` +
    `Motivo: ${codigo}. Comprobante: ${comprobante}. BAC Credomatic`;

  it('un pago con su código y su monto activa el pedido', async () => {
    const cuenta = await account();
    const pedido = await order(2_500_000);

    const resultado = await ingestSinpeEmail(
      cuenta,
      'SINPE Móvil',
      aviso('25.000,00', '2026091012345678901234567', pedido.payCode),
    );
    assert.equal(resultado.kind, 'stored');
    assert.equal(resultado.kind === 'stored' ? resultado.applied : false, true);

    const despues = await getPrisma().order.findUniqueOrThrow({ where: { id: pedido.id } });
    assert.equal(despues.status, 'paid');

    const pago = await getPrisma().payment.findFirstOrThrow({ where: { orderId: pedido.id } });
    assert.equal(pago.provider, 'sinpe');
    assert.equal(pago.providerRef, '2026091012345678901234567', 'el comprobante ES la referencia');
    assert.equal(pago.status, 'paid');
    assert.equal(pago.amount, 2_500_000);
  });

  it('el mismo correo leído dos veces no cobra dos veces', async () => {
    const cuenta = await account();
    const pedido = await order(2_500_000);
    const correo = aviso('25.000,00', '2026091012345678901234567', pedido.payCode);

    const primera = await ingestSinpeEmail(cuenta, 'SINPE Móvil', correo);
    const segunda = await ingestSinpeEmail(cuenta, 'SINPE Móvil', correo);

    assert.equal(primera.kind, 'stored');
    assert.equal(segunda.kind, 'duplicate', 'el comprobante ya estaba');
    assert.equal(await getPrisma().sinpeMovement.count(), 1);
    assert.equal(await getPrisma().payment.count({ where: { orderId: pedido.id } }), 1);
  });

  it('el monto tiene que ser EXACTO', async () => {
    const cuenta = await account();
    const pedido = await order(2_500_000);

    // Un colón de menos. No se casa: no hay «casi».
    await ingestSinpeEmail(
      cuenta,
      'SINPE Móvil',
      aviso('24.999,00', '2026091099999999999999999', pedido.payCode),
    );

    const movimiento = await getPrisma().sinpeMovement.findFirstOrThrow();
    assert.equal(movimiento.status, 'pending', 'queda para que lo mire una persona');
    assert.equal((await getPrisma().order.findUniqueOrThrow({ where: { id: pedido.id } })).status, 'pending');
  });

  it('NUNCA por monto solo: sin el código no se casa con nadie', async () => {
    const cuenta = await account();
    const pedido = await order(2_500_000);

    await ingestSinpeEmail(
      cuenta,
      'SINPE Móvil',
      'Ha recibido un SINPE Móvil de ANA SOLIS por ₡25.000,00. ' +
        'Comprobante: 2026091012345678901234567. BAC Credomatic',
    );

    assert.equal((await getPrisma().sinpeMovement.findFirstOrThrow()).status, 'pending');
    assert.equal((await getPrisma().order.findUniqueOrThrow({ where: { id: pedido.id } })).status, 'pending');
  });

  it('dos oficinas con el mismo plan el mismo día no se confunden', async () => {
    // Este es el caso que obliga a que exista el código: dos pedidos idénticos
    // en importe, y el dinero tiene que ir a UNO.
    const cuenta = await account();
    const unoA = await order(2_500_000, fixture.get().tenantId);
    const otraB = await order(2_500_000, fixture.get().otherTenantId);

    await ingestSinpeEmail(
      cuenta,
      'SINPE Móvil',
      aviso('25.000,00', '2026091012345678901234567', otraB.payCode),
    );

    const a = await getPrisma().order.findUniqueOrThrow({ where: { id: unoA.id } });
    const b = await getPrisma().order.findUniqueOrThrow({ where: { id: otraB.id } });
    assert.equal(a.status, 'pending', 'la que no pagó sigue sin pagar');
    assert.equal(b.status, 'paid', 'la que puso su código');
  });

  it('el buzón de una oficina no puede cobrar el pedido de otra', async () => {
    // Fase 2: cada oficina con su buzón. Un correo que llegue al buzón de A no
    // puede tocar un pedido de B ni aunque traiga su código.
    const cuentaA = await account(fixture.get().tenantId);
    const pedidoB = await order(1_000_000, fixture.get().otherTenantId);

    await ingestSinpeEmail(
      cuentaA,
      'SINPE Móvil',
      aviso('10.000,00', '2026091055555555555555555', pedidoB.payCode),
    );

    assert.equal((await getPrisma().order.findUniqueOrThrow({ where: { id: pedidoB.id } })).status, 'pending');
    assert.equal((await getPrisma().sinpeMovement.findFirstOrThrow()).status, 'pending');
  });

  it('un SINPE enviado no se guarda siquiera', async () => {
    const cuenta = await account();
    const resultado = await ingestSinpeEmail(
      cuenta,
      'Transacción',
      'Se ha realizado un débito en su cuenta por transferencia SINPE Móvil ' +
        'por ₡25.000,00. Comprobante: 2026091012345678901234567. BAC',
    );
    assert.equal(resultado.kind, 'ignored');
    assert.equal(resultado.kind === 'ignored' ? resultado.reason : '', 'outgoing');
    assert.equal(await getPrisma().sinpeMovement.count(), 0, 'no ensucia la pantalla');
  });

  it('el aviso repetido de cuenta SÍ se guarda, y como ignorado', async () => {
    // Se guarda a propósito: el dueño ya se confundió una vez creyendo que eran
    // pagos repetidos. Verlo escrito, con su motivo, es lo que lo evita.
    const cuenta = await account();
    const resultado = await ingestSinpeEmail(
      cuenta,
      'Movimiento',
      'Le informamos que se realizó un crédito en su cuenta por ₡25.000,00. ' +
        'Referencia: 987654. BAC Credomatic',
    );
    assert.equal(resultado.kind, 'ignored');
    assert.equal(resultado.kind === 'ignored' ? resultado.reason : '', 'account_notice');

    const movimiento = await getPrisma().sinpeMovement.findFirstOrThrow();
    assert.equal(movimiento.status, 'ignored');
    // Con su importe de verdad. Guardarlo en cero decía «llegó algo» y no
    // «llegó esto y no se cobró porque es el mismo dinero», que es la frase
    // que evita la confusión — al dueño ya le pasó una vez.
    assert.equal(movimiento.amount, 2_500_000);
  });

  it('un pedido ya pagado no se vuelve a cobrar', async () => {
    const cuenta = await account();
    const pedido = await order(2_500_000);
    await ingestSinpeEmail(
      cuenta,
      'SINPE Móvil',
      aviso('25.000,00', '2026091011111111111111111', pedido.payCode),
    );

    // Otro SINPE, otro comprobante, el mismo código. El pedido ya está pagado,
    // así que no hay nada que casar: se queda pendiente para que lo mire alguien.
    await ingestSinpeEmail(
      cuenta,
      'SINPE Móvil',
      aviso('25.000,00', '2026091022222222222222222', pedido.payCode),
    );

    const pagos = await getPrisma().payment.findMany({ where: { orderId: pedido.id } });
    assert.equal(pagos.length, 1, 'un solo cobro');
    const sueltos = await getPrisma().sinpeMovement.findMany({ where: { status: 'pending' } });
    assert.equal(sueltos.length, 1, 'el segundo queda a la vista, sin dueño');
  });

  it('volver a intentar casar un movimiento ya aplicado no hace nada', async () => {
    const cuenta = await account();
    const pedido = await order(2_500_000);
    await ingestSinpeEmail(
      cuenta,
      'SINPE Móvil',
      aviso('25.000,00', '2026091033333333333333333', pedido.payCode),
    );
    const movimiento = await getPrisma().sinpeMovement.findFirstOrThrow();

    assert.equal(await tryMatch(movimiento.id), false);
    assert.equal(await getPrisma().payment.count({ where: { orderId: pedido.id } }), 1);
  });

  it('releer el mismo aviso de cuenta no guarda dos filas', async () => {
    // El temporizador relee cada cinco minutos con solape, así que este correo
    // vuelve a pasar por aquí tres veces. Su referencia NO sirve de clave —es
    // siempre la misma, identifica al aviso y no al movimiento— así que la
    // clave sale de una huella del correo, y tiene que ser determinista.
    const cuenta = await account();
    const correo =
      'Le informamos que se realizó un crédito en su cuenta por ₡250,00. ' +
      'Referencia: 1054101. Davivienda';

    await ingestSinpeEmail(cuenta, 'Movimiento', correo);
    await ingestSinpeEmail(cuenta, 'Movimiento', correo);
    await ingestSinpeEmail(cuenta, 'Movimiento', correo);

    const filas = await getPrisma().sinpeMovement.findMany();
    assert.equal(filas.length, 1, 'una sola fila');
    assert.equal(filas[0]?.status, 'ignored');
    assert.equal(filas[0]?.amount, 25_000, 'con su importe de verdad, no un cero');
  });

  it('dos avisos de cuenta distintos con la MISMA referencia caben los dos', async () => {
    // En el sistema del dueño la referencia `1054101` se repite en cinco
    // correos distintos, con importes distintos. Si fuera la clave, cuatro se
    // habrían perdido.
    const cuenta = await account();
    for (const monto of ['250,00', '29,00', '1.000,00']) {
      await ingestSinpeEmail(
        cuenta,
        'Movimiento',
        `Se realizó un crédito en su cuenta por ₡${monto}. Referencia: 1054101. Davivienda`,
      );
    }
    assert.equal(await getPrisma().sinpeMovement.count(), 3);
  });

  it('el correo real de Davivienda cobra un pedido', async () => {
    const cuenta = await account();
    const pedido = await order(6_600_000);

    const resultado = await ingestSinpeEmail(
      cuenta,
      'Recepción de pago por SINPE Móvil',
      `Ha recibido 66,000.00 Colones de DEYNA_MARIA_GUZMAN_C por SINPE Movil. ` +
        `Motivo ${pedido.payCode}. Comprobante 2026090910283002226510944`,
      'notificaciones.gx@davivienda.cr',
    );
    assert.equal(resultado.kind, 'stored');
    assert.equal(resultado.kind === 'stored' ? resultado.applied : false, true);

    const movimiento = await getPrisma().sinpeMovement.findFirstOrThrow();
    assert.equal(movimiento.senderName, 'DEYNA MARIA GUZMAN C');
    assert.equal(movimiento.bank, 'davivienda');
    assert.equal((await getPrisma().order.findUniqueOrThrow({ where: { id: pedido.id } })).status, 'paid');
  });

  it('el código se lee aunque venga en minúsculas o pegado a un punto', async () => {
    const cuenta = await account();
    const pedido = await order(500_000);

    await ingestSinpeEmail(
      cuenta,
      'SINPE Móvil',
      `Ha recibido un SINPE Móvil de ANA por ₡5.000,00. Motivo: pago ` +
        `${pedido.payCode.toLowerCase()}. Comprobante: 2026091044444444444444444. BAC`,
    );
    assert.equal((await getPrisma().order.findUniqueOrThrow({ where: { id: pedido.id } })).status, 'paid');
  });
});
