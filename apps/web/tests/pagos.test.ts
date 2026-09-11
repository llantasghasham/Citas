import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';

import { POST as callback } from '../src/app/api/payments/[provider]/callback/route';
import { beginPublicPayment, openPackageOrder } from '../src/lib/billing/checkout';
import { applySettlement, reconcilePending } from '../src/lib/billing/reconcile';
import {
  alreadySeen,
  MAX_CALLBACK_BYTES,
  rateLimited,
  resetCallbackGuards,
  tooLarge,
} from '../src/lib/payments/callback-guard';
import { PaymentError } from '../src/lib/payments/types';
import { openCollection } from '../src/lib/billing/reserve';
import type { PaymentProvider } from '../src/lib/payments/types';
import { controlDb } from '../src/lib/db/client';
import { tenantScope } from '../src/lib/db/tenant';
import { encryptSecret } from '../src/lib/secrets';

import { HAS_DB, makeEvent, withDatabase } from './helpers';

/**
 * El cobro, contra un Whish de mentira que imita su contrato: el sobre
 * `{status, code, dialog, data}`, el 200 aunque haya rechazado, y la búsqueda
 * por `(externalId, currency)`.
 */
const PORT = 4055;
const collected = new Map<string, { estado: string; currency: string }>();

function fakeWhish(): Server {
  return createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = req.url ?? '';
      res.setHeader('content-type', 'application/json');

      if (url.endsWith('/payment/collect')) {
        const { externalId, currency } = JSON.parse(body || '{}');
        collected.set(String(externalId), { estado: 'pending', currency });
        res.end(JSON.stringify({
          status: true, data: { collectUrl: `http://127.0.0.1:${PORT}/pagina?id=${externalId}` },
        }));
        return;
      }
      if (url.endsWith('/payment/collect/status')) {
        const { externalId, currency } = JSON.parse(body || '{}');
        const row = collected.get(String(externalId));
        // Como el de verdad: se busca por (externalId, currency).
        if (row === undefined || row.currency !== currency) {
          res.end(JSON.stringify({ status: false, code: 'NOT_FOUND', data: null }));
          return;
        }
        const before_ = row.estado;
        collected.set(String(externalId), { ...row, estado: 'paid' });
        res.end(JSON.stringify({
          status: true, data: { collectStatus: before_ === 'pending' ? 'pending' : 'success' },
        }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
}

describe('el cobro', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();
  let server: Server;

  before(async () => {
    server = fakeWhish();
    await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));

    const prisma = controlDb();
    for (const [key, value] of [
      ['WHISH_BASE_URL', `http://127.0.0.1:${PORT}/itel-service/api`],
      ['WHISH_CHANNEL', 'canal'],
      ['WHISH_WEBSITE_URL', 'https://citas.posxml.com'],
      ['PAYMENTS_PROVIDER', 'whish'],
    ] as const) {
      await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    }
    const enc = encryptSecret('clave');
    await prisma.setting.upsert({
      where: { key: 'WHISH_SECRET' }, update: { valueEnc: enc }, create: { key: 'WHISH_SECRET', valueEnc: enc },
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await controlDb().setting.deleteMany({
      where: { key: { in: ['WHISH_BASE_URL','WHISH_CHANNEL','WHISH_WEBSITE_URL','WHISH_SECRET','PAYMENTS_PROVIDER'] } },
    });
  });

  beforeEach(async () => {
    const prisma = controlDb();
    await prisma.paymentEvent.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.auditLog.deleteMany({ where: { action: { startsWith: 'order.' } } });
    collected.clear();
  });

  const newOrder = async (): Promise<string> => {
    const eventId = await makeEvent(fixture.get().tenantId);
    const result = await openPackageOrder(
      tenantScope(fixture.get().tenantId),
      { eventId, packageId: 'p200', clientName: 'Pareja', clientPhone: null },
      fixture.get().userId,
    );
    if ('error' in result) throw new Error(result.error);
    return result.payToken;
  };

  const notify = async (providerRef: string): Promise<Response> =>
    callback(
      new Request('https://citas.posxml.com/api/payments/whish/callback', {
        method: 'POST',
        body: JSON.stringify({ externalId: Number(providerRef), status: 'success' }),
      }),
      { params: Promise.resolve({ provider: 'whish' }) },
    );

  it('un doble clic no abre dos cobranzas', async () => {
    const token = await newOrder();
    const [a, b] = await Promise.all([
      beginPublicPayment(token, 'https://citas.posxml.com'),
      beginPublicPayment(token, 'https://citas.posxml.com'),
    ]);
    assert.ok('payUrl' in a && 'payUrl' in b);
    assert.equal(a.payUrl, b.payUrl, 'el mismo enlace');
    assert.equal(await controlDb().payment.count(), 1);
  });

  /**
   * El freno de repeticiones corta el MISMO aviso byte a byte durante un
   * minuto, y eso es lo que se quiere en producción. Aquí estorba: lo que estas
   * pruebas comprueban es la idempotencia de la LIQUIDACIÓN, que vive detrás de
   * ese freno. Se suelta entre avisos para llegar hasta ella — comprobar el
   * freno es otra prueba, y está más abajo.
   */
  const notifyAgain = async (ref: string): Promise<Response> => {
    resetCallbackGuards();
    return notify(ref);
  };

  it('el aviso del proveedor activa el PEDIDO, no solo el cobro', async () => {
    const token = await newOrder();
    await beginPublicPayment(token, 'https://citas.posxml.com');
    const payment = await controlDb().payment.findFirstOrThrow();

    // El falso da «pendiente» la primera vez; se consume para llegar a pagado.
    await notifyAgain(payment.providerRef);
    const response = await notifyAgain(payment.providerRef);
    assert.equal(response.status, 200);

    const order = await controlDb().order.findFirstOrThrow({ where: { payToken: token } });
    assert.equal(order.status, 'paid');
    assert.equal(await controlDb().auditLog.count({ where: { action: 'order.paid' } }), 1);
  });

  it('el mismo aviso repetido no activa nada dos veces', async () => {
    const token = await newOrder();
    await beginPublicPayment(token, 'https://citas.posxml.com');
    const payment = await controlDb().payment.findFirstOrThrow();
    await notifyAgain(payment.providerRef);
    await notifyAgain(payment.providerRef);
    await notifyAgain(payment.providerRef);
    await notifyAgain(payment.providerRef);
    assert.equal(await controlDb().auditLog.count({ where: { action: 'order.paid' } }), 1);
  });

  it('una respuesta atrasada no devuelve a pendiente lo ya pagado', async () => {
    const token = await newOrder();
    await beginPublicPayment(token, 'https://citas.posxml.com');
    const payment = await controlDb().payment.findFirstOrThrow();
    await notifyAgain(payment.providerRef);
    await notifyAgain(payment.providerRef);

    const order = await controlDb().order.findFirstOrThrow({
      where: { payToken: token },
      select: { id: true, tenantId: true, amount: true, description: true, packageGuests: true },
    });
    assert.equal(await applySettlement(order, payment.id, 'pending', 'job'), false);
    assert.equal((await controlDb().order.findUniqueOrThrow({ where: { id: order.id } })).status, 'paid');
  });

  it('dos liquidaciones simultáneas y solo una escribe', async () => {
    const token = await newOrder();
    await beginPublicPayment(token, 'https://citas.posxml.com');
    const payment = await controlDb().payment.findFirstOrThrow();
    const order = await controlDb().order.findFirstOrThrow({
      where: { payToken: token },
      select: { id: true, tenantId: true, amount: true, description: true, packageGuests: true },
    });

    const both = await Promise.all([
      applySettlement(order, payment.id, 'paid', 'callback'),
      applySettlement(order, payment.id, 'paid', 'job'),
    ]);
    assert.equal(both.filter(Boolean).length, 1);
    assert.equal(await controlDb().auditLog.count({ where: { action: 'order.paid' } }), 1);
  });

  it('un aviso con una referencia inventada no encuentra nada', async () => {
    const response = await notify('999999999999');
    assert.equal(response.status, 404);
  });

  it('el repaso pregunta al proveedor con el que se abrió el cobro', async () => {
    const token = await newOrder();
    await beginPublicPayment(token, 'https://citas.posxml.com');
    const payment = await controlDb().payment.findFirstOrThrow();
    assert.equal(payment.provider, 'whish', 'se guarda el proveedor, no «manual»');

    // Pasado el periodo de gracia.
    await controlDb().payment.updateMany({ data: { createdAt: new Date(Date.now() - 10 * 60 * 1000) } });
    await reconcilePending();
    const second = await reconcilePending();
    assert.equal(second.paid, 1);
    assert.equal((await controlDb().order.findFirstOrThrow({ where: { payToken: token } })).status, 'paid');
  });

  it('el efectivo no se le pregunta a nadie', async () => {
    const token = await newOrder();
    const order = await controlDb().order.findFirstOrThrow({ where: { payToken: token } });
    await controlDb().payment.create({
      data: {
        orderId: order.id, provider: 'manual', providerRef: `cash_${order.id}`,
        status: 'pending', amount: order.amount, currency: order.currency,
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });
    const summary = await reconcilePending();
    assert.equal(summary.checked, 0, 'el efectivo no entra en el repaso');
  });
});

/**
 * Abrir una cobranza sin poder abrir dos.
 *
 * Llegó por un informe externo y era cierto: se llamaba al proveedor y DESPUÉS
 * se escribía la fila. El índice impedía guardar la segunda fila, pero no
 * impedía que se hubiera creado la segunda cobranza — esa se quedaba viva en la
 * pasarela, con su enlace, esperando a que alguien la pagara.
 */
describe('la reserva del cobro', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();

  beforeEach(async () => {
    const prisma = controlDb();
    await prisma.payment.deleteMany({});
    await prisma.order.deleteMany({});
  });

  /** Un proveedor que cuenta cuántas cobranzas se le pidieron de verdad. */
  const contador = (): { provider: PaymentProvider; veces: () => number } => {
    let veces = 0;
    const provider: PaymentProvider = {
      id: 'mock',
      createCollection: async (request) => {
        veces += 1;
        // Tarda, que es cuando ocurren las carreras.
        await new Promise((resolve) => setTimeout(resolve, 120));
        return {
          provider: 'mock',
          providerRef: request.reference,
          payUrl: `https://pasarela.example/${request.reference}`,
          status: 'pending',
        };
      },
      getStatus: () => Promise.resolve({ status: 'pending' as const }),
      verifyCallback: () => Promise.reject(new Error('no se usa')),
    };
    return { provider, veces: () => veces };
  };

  const abrirCon = (provider: PaymentProvider, orderId: string): Promise<unknown> =>
    openCollection(provider, {
      orderId,
      amount: 1500,
      currency: 'USD',
      description: 'Plan Annual',
      successUrl: 'https://citas.example/ok',
      failureUrl: 'https://citas.example/no',
      callbackUrl: 'https://citas.example/cb',
    });

  const pedidoDeReserva = async (): Promise<string> => pedido();

  const pedido = async (): Promise<string> => {
    const row = await controlDb().order.create({
      data: {
        tenantId: fixture.get().tenantId,
        amount: 1500,
        currency: 'USD',
        description: 'Plan Annual',
        status: 'pending',
      },
      select: { id: true },
    });
    return row.id;
  };

  it('dos peticiones a la vez abren UNA sola cobranza en la pasarela', async () => {
    const { provider, veces } = contador();
    const orderId = await pedido();
    const abrir = (): Promise<unknown> =>
      openCollection(provider, {
        orderId,
        amount: 1500,
        currency: 'USD',
        description: 'Plan Annual',
        successUrl: 'https://citas.example/ok',
        failureUrl: 'https://citas.example/no',
        callbackUrl: 'https://citas.example/cb',
      });

    const [uno, dos] = await Promise.all([abrir(), abrir()]);

    assert.equal(veces(), 1, 'a la pasarela se le pidió UNA vez');
    assert.equal(await controlDb().payment.count({ where: { orderId } }), 1);

    // Y las dos peticiones se llevan el mismo enlace, no un error.
    const urls = [uno, dos].map((r) => (r as { ok: boolean; payUrl?: string }).payUrl);
    assert.equal(urls[0], urls[1]);
    assert.ok(typeof urls[0] === 'string' && urls[0].length > 0);
  });

  it('volver a pulsar después reutiliza el enlace, sin llamar otra vez', async () => {
    const { provider, veces } = contador();
    const orderId = await pedido();
    const abrir = (): Promise<unknown> =>
      openCollection(provider, {
        orderId,
        amount: 1500,
        currency: 'USD',
        description: 'Plan Annual',
        successUrl: 'https://citas.example/ok',
        failureUrl: 'https://citas.example/no',
        callbackUrl: 'https://citas.example/cb',
      });

    await abrir();
    await abrir();
    assert.equal(veces(), 1);
  });

  it('un fallo AMBIGUO conserva la reserva; uno definitivo la suelta', async () => {
    // Esta prueba decía antes que «si la pasarela falla, la reserva se suelta».
    // Eso era describir el fallo, no probarlo: con un tiempo agotado la
    // cobranza puede existir al otro lado, y soltarla dejaba abrir una segunda.
    const orderId = await pedidoDeReserva();

    const ambiguo: PaymentProvider = {
      id: 'mock',
      createCollection: () => Promise.reject(new Error('socket hang up')),
      getStatus: () => Promise.resolve({ status: 'pending' as const }),
      verifyCallback: () => Promise.reject(new Error('no se usa')),
    };
    const salida = (await abrirCon(ambiguo, orderId)) as { ok: boolean; reason?: string };
    assert.equal(salida.reason, 'unknown');
    assert.equal(await controlDb().payment.count({ where: { orderId } }), 1, 'se conserva');

    await controlDb().payment.deleteMany({ where: { orderId } });

    let primera = true;
    const definitivo: PaymentProvider = {
      id: 'mock',
      createCollection: (request) => {
        if (primera) {
          primera = false;
          return Promise.reject(new PaymentError('datos inválidos', 'mock', { definitive: true }));
        }
        return Promise.resolve({
          provider: 'mock' as const,
          providerRef: request.reference,
          payUrl: `https://pasarela.example/${request.reference}`,
          status: 'pending' as const,
        });
      },
      getStatus: () => Promise.resolve({ status: 'pending' as const }),
      verifyCallback: () => Promise.reject(new Error('no se usa')),
    };

    await assert.rejects(abrirCon(definitivo, orderId));
    // Sin soltarla, el reintento chocaría contra el índice para siempre.
    assert.equal(await controlDb().payment.count({ where: { orderId } }), 0);
    assert.equal(((await abrirCon(definitivo, orderId)) as { ok: boolean }).ok, true);
  });
});

/**
 * Lo que el proveedor dice que cobró, y lo que quedó en el aire.
 *
 * Los dos llegaron por la cuarta revisión del informe externo y los dos eran
 * ciertos: el importe no se comprobaba de verdad, y la ventana entre crear la
 * cobranza y guardarla dejaba abrir una segunda.
 */
describe('el importe y las reservas en el aire', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();

  beforeEach(async () => {
    const prisma = controlDb();
    await prisma.paymentEvent.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.subscription.deleteMany({});
  });

  const pedidoConCobro = async (): Promise<{ orderId: string; paymentId: string }> => {
    const prisma = controlDb();
    const order = await prisma.order.create({
      data: {
        tenantId: fixture.get().tenantId,
        amount: 12000,
        currency: 'USD',
        description: 'Plan Office',
        status: 'pending',
      },
      select: { id: true, tenantId: true, amount: true, description: true, packageGuests: true },
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'mock',
        providerRef: `ref-${Math.random().toString(36).slice(2, 10)}`,
        status: 'pending',
        amount: 12000,
        currency: 'USD',
      },
      select: { id: true },
    });
    return { orderId: order.id, paymentId: payment.id };
  };

  const orderRow = async (orderId: string) =>
    controlDb().order.findUniqueOrThrow({
      where: { id: orderId },
      select: { id: true, tenantId: true, amount: true, description: true, packageGuests: true, status: true },
    });

  it('un importe que no cuadra NO activa nada', async () => {
    const { orderId, paymentId } = await pedidoConCobro();
    const order = await orderRow(orderId);

    // Pagó mil doscientos de ciento veinte mil. «Pagado» no es «pagado lo que
    // se pedía», y activar el plano aquí es regalar el producto.
    const cambio = await applySettlement(order, paymentId, 'paid', 'callback', {
      amount: 1200,
      currency: 'USD',
    });

    assert.equal(cambio, false);
    assert.equal((await orderRow(orderId)).status, 'pending');
    assert.equal(
      (await controlDb().payment.findUniqueOrThrow({ where: { id: paymentId } })).status,
      'pending',
      'se queda pendiente para que el repaso lo siga mirando',
    );

    // Y queda escrito lo que llegó, que es lo único que sirve si se discute.
    const evento = await controlDb().paymentEvent.findFirstOrThrow({ where: { paymentId } });
    assert.equal(evento.kind, 'amount_mismatch');
  });

  it('una MONEDA que no cuadra tampoco', async () => {
    const { orderId, paymentId } = await pedidoConCobro();
    const order = await orderRow(orderId);

    const cambio = await applySettlement(order, paymentId, 'paid', 'callback', {
      amount: 12000,
      currency: 'LBP',
    });
    assert.equal(cambio, false);
    assert.equal((await orderRow(orderId)).status, 'pending');
  });

  it('el importe correcto sí liquida', async () => {
    const { orderId, paymentId } = await pedidoConCobro();
    const order = await orderRow(orderId);

    assert.equal(
      await applySettlement(order, paymentId, 'paid', 'callback', {
        amount: 12000,
        currency: 'USD',
      }),
      true,
    );
    assert.equal((await orderRow(orderId)).status, 'paid');
  });

  it('sin importe del proveedor se liquida igual, y se sabe que no se comprobó', async () => {
    // Es lo honesto mientras Whish no lo devuelva: negarse a cobrar porque el
    // proveedor no dice el importe dejaría sin cobrar todo.
    const { orderId, paymentId } = await pedidoConCobro();
    const order = await orderRow(orderId);
    assert.equal(await applySettlement(order, paymentId, 'paid', 'callback'), true);
    assert.equal((await orderRow(orderId)).status, 'paid');
  });

  it('un tiempo agotado NO suelta la reserva: la cobranza puede existir', async () => {
    // Esta es la ventana exacta que señaló el informe. Antes se soltaba pasara
    // lo que pasara, así que un reintento abría una SEGUNDA cobranza de verdad.
    const orderId = (await pedidoConCobro()).orderId;
    await controlDb().payment.deleteMany({ where: { orderId } });

    const provider: PaymentProvider = {
      id: 'mock',
      createCollection: () => Promise.reject(new Error('The operation was aborted due to timeout')),
      getStatus: () => Promise.resolve({ status: 'pending' as const }),
      verifyCallback: () => Promise.reject(new Error('no se usa')),
    };

    const salida = (await openCollection(provider, {
      orderId,
      amount: 12000,
      currency: 'USD',
      description: 'Plan Office',
      successUrl: 'https://citas.example/ok',
      failureUrl: 'https://citas.example/no',
      callbackUrl: 'https://citas.example/cb',
    })) as { ok: boolean; reason?: string };

    assert.equal(salida.ok, false);
    assert.equal(salida.reason, 'unknown', 'ni sí ni no: no se sabe');
    assert.equal(
      await controlDb().payment.count({ where: { orderId, status: 'pending' } }),
      1,
      'la reserva se CONSERVA: es lo único que ata esa referencia al pedido',
    );
    const evento = await controlDb().paymentEvent.findFirst({ where: { kind: 'open_unknown' } });
    assert.notEqual(evento, null, 'y queda escrito por qué');
  });

  it('una negativa EXPLÍCITA sí la suelta: no se creó nada', async () => {
    const orderId = (await pedidoConCobro()).orderId;
    await controlDb().payment.deleteMany({ where: { orderId } });

    const provider: PaymentProvider = {
      id: 'mock',
      createCollection: () =>
        Promise.reject(new PaymentError('datos inválidos', 'mock', { definitive: true })),
      getStatus: () => Promise.resolve({ status: 'pending' as const }),
      verifyCallback: () => Promise.reject(new Error('no se usa')),
    };
    const abrir = (): Promise<unknown> =>
      openCollection(provider, {
        orderId,
        amount: 12000,
        currency: 'USD',
        description: 'Plan Office',
        successUrl: 'https://citas.example/ok',
        failureUrl: 'https://citas.example/no',
        callbackUrl: 'https://citas.example/cb',
      });

    await assert.rejects(abrir());
    assert.equal(await controlDb().payment.count({ where: { orderId } }), 0, 'se puede reintentar');
  });

  it('un cobro de hace dos meses se cierra en vez de quedarse pendiente para siempre', async () => {
    // El repaso solo mira la ventana de treinta días, así que lo anterior se
    // quedaba «pendiente» eternamente — y con el índice de «un cobro abierto
    // por pedido», ese pedido no se podía cobrar nunca más.
    const { orderId } = await pedidoConCobro();
    const viejo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    await controlDb().payment.updateMany({ where: { orderId }, data: { createdAt: viejo } });

    const resumen = await reconcilePending();
    assert.ok(resumen.expired >= 1, `caducados: ${resumen.expired}`);
    assert.equal(
      (await controlDb().payment.findFirstOrThrow({ where: { orderId } })).status,
      'expired',
    );
  });

  it('una reserva en el aire que el proveedor dice PAGADA se liquida', async () => {
    // Esto es lo que se protege al no borrarla: la cobranza huérfana existía y
    // alguien la pagó. Sin la fila, ese cobro no se podría ni reconocer.
    const { orderId, paymentId } = await pedidoConCobro();
    await controlDb().payment.update({
      where: { id: paymentId },
      data: { payUrl: null, createdAt: new Date(Date.now() - 20 * 60 * 1000) },
    });

    await reconcilePending();
    assert.equal((await orderRow(orderId)).status, 'paid', 'el doble `mock` la da por pagada');
  });
});

/**
 * Los frenos del extremo por el que entra un aviso de cobro.
 *
 * Ese extremo es público y no va firmado, así que cualquiera puede llamarlo mil
 * veces. Que no pueda COBRAR nada ya estaba resuelto —nada del cuerpo decide—;
 * lo que faltaba es que llamarlo mil veces no costara mil consultas a la
 * pasarela ni mil filas en el historial.
 */
describe('el extremo del aviso de cobro', () => {
  beforeEach(() => {
    resetCallbackGuards();
  });

  it('un cuerpo enorme se rechaza por la cabecera, sin llegar a leerlo', () => {
    const grande = new Headers({ 'content-length': String(MAX_CALLBACK_BYTES + 1) });
    assert.equal(tooLarge(grande), true);
    assert.equal(tooLarge(new Headers({ 'content-length': '400' })), false);
  });

  it('y también si la cabecera miente', () => {
    // `content-length` lo escribe quien llama, como todo lo demás.
    const miente = new Headers({ 'content-length': '10' });
    assert.equal(tooLarge(miente), false, 'la cabecera pasa');
    assert.equal(tooLarge(miente, 'x'.repeat(MAX_CALLBACK_BYTES + 1)), true, 'el cuerpo no');
  });

  it('una misma dirección tiene cupo por minuto', () => {
    let frenados = 0;
    for (let intento = 0; intento < 200; intento += 1) {
      if (rateLimited('whish:203.0.113.7')) frenados += 1;
    }
    assert.ok(frenados > 100, `frenados ${frenados} de 200`);
    // Y no arrastra a los demás.
    assert.equal(rateLimited('whish:198.51.100.4'), false);
  });

  it('el cupo se renueva al pasar el minuto', () => {
    const ahora = Date.now();
    for (let intento = 0; intento < 200; intento += 1) rateLimited('whish:x', ahora);
    assert.equal(rateLimited('whish:x', ahora), true);
    assert.equal(rateLimited('whish:x', ahora + 61_000), false);
  });

  it('el MISMO aviso repetido no se vuelve a tramitar', () => {
    const cuerpo = '{"externalId":"123","status":"success"}';
    assert.equal(alreadySeen('whish', cuerpo), false, 'la primera vez sí');
    assert.equal(alreadySeen('whish', cuerpo), true, 'la segunda no');
  });

  it('pero dos avisos DISTINTOS del mismo cobro se tramitan los dos', () => {
    // «pendiente» y luego «pagado» son cuerpos distintos, y el segundo es el
    // que importa. Cortar por referencia en vez de por cuerpo lo habría perdido.
    assert.equal(alreadySeen('whish', '{"externalId":"9","status":"pending"}'), false);
    assert.equal(alreadySeen('whish', '{"externalId":"9","status":"success"}'), false);
  });

  it('y el olvido llega: pasado el rato, se vuelve a tramitar', () => {
    const ahora = Date.now();
    const cuerpo = '{"externalId":"7"}';
    assert.equal(alreadySeen('whish', cuerpo, ahora), false);
    assert.equal(alreadySeen('whish', cuerpo, ahora + 1000), true);
    assert.equal(alreadySeen('whish', cuerpo, ahora + 61_000), false);
  });
});

describe('la liquidación es atómica de verdad', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();

  beforeEach(async () => {
    const prisma = controlDb();
    await prisma.paymentEvent.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.subscription.deleteMany({});
  });

  it('si algo falla a mitad, NO queda nada escrito', async () => {
    // `applySettlement` escribe el pago, el pedido, la suscripción y el
    // historial. Antes eran cuatro escrituras sueltas: morir entre la segunda y
    // la tercera dejaba un pedido COBRADO y sin plan activo — pagado y sin
    // producto, que es la peor de las dos maneras de equivocarse.
    //
    // El fallo se provoca con una restricción de verdad: el historial apunta a
    // una oficina por clave foránea, así que con una oficina inventada la
    // escritura del historial revienta DENTRO de la transacción.
    const prisma = controlDb();
    const order = await prisma.order.create({
      data: {
        tenantId: fixture.get().tenantId,
        amount: 1500,
        currency: 'USD',
        description: 'Plan Annual',
        status: 'pending',
      },
      select: { id: true, amount: true, description: true, packageGuests: true },
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'mock',
        providerRef: `atomico-${Date.now()}`,
        status: 'pending',
        amount: 1500,
        currency: 'USD',
      },
      select: { id: true },
    });

    await assert.rejects(
      applySettlement({ ...order, tenantId: 'oficina-que-no-existe' }, payment.id, 'paid', 'job'),
      'la clave foránea del historial tiene que reventar',
    );

    // Y después: TODO como estaba.
    assert.equal(
      (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
      'pending',
      'el pago no se marcó pagado',
    );
    assert.equal(
      (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status,
      'pending',
      'el pedido tampoco',
    );
    assert.equal(
      await prisma.auditLog.count({ where: { entityId: order.id } }),
      0,
      'ni quedó media línea de historial',
    );
  });
});
