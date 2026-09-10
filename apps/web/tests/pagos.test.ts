import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';

import { POST as callback } from '../src/app/api/payments/[provider]/callback/route';
import { beginPublicPayment, openPackageOrder } from '../src/lib/billing/checkout';
import { applySettlement, reconcilePending } from '../src/lib/billing/reconcile';
import { getPrisma } from '../src/lib/db/client';
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

    const prisma = getPrisma();
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
    await getPrisma().setting.deleteMany({
      where: { key: { in: ['WHISH_BASE_URL','WHISH_CHANNEL','WHISH_WEBSITE_URL','WHISH_SECRET','PAYMENTS_PROVIDER'] } },
    });
  });

  beforeEach(async () => {
    const prisma = getPrisma();
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
    assert.equal(await getPrisma().payment.count(), 1);
  });

  it('el aviso del proveedor activa el PEDIDO, no solo el cobro', async () => {
    const token = await newOrder();
    await beginPublicPayment(token, 'https://citas.posxml.com');
    const payment = await getPrisma().payment.findFirstOrThrow();

    // El falso da «pendiente» la primera vez; se consume para llegar a pagado.
    await notify(payment.providerRef);
    const response = await notify(payment.providerRef);
    assert.equal(response.status, 200);

    const order = await getPrisma().order.findFirstOrThrow({ where: { payToken: token } });
    assert.equal(order.status, 'paid');
    assert.equal(await getPrisma().auditLog.count({ where: { action: 'order.paid' } }), 1);
  });

  it('el mismo aviso repetido no activa nada dos veces', async () => {
    const token = await newOrder();
    await beginPublicPayment(token, 'https://citas.posxml.com');
    const payment = await getPrisma().payment.findFirstOrThrow();
    await notify(payment.providerRef);
    await notify(payment.providerRef);
    await notify(payment.providerRef);
    await notify(payment.providerRef);
    assert.equal(await getPrisma().auditLog.count({ where: { action: 'order.paid' } }), 1);
  });

  it('una respuesta atrasada no devuelve a pendiente lo ya pagado', async () => {
    const token = await newOrder();
    await beginPublicPayment(token, 'https://citas.posxml.com');
    const payment = await getPrisma().payment.findFirstOrThrow();
    await notify(payment.providerRef);
    await notify(payment.providerRef);

    const order = await getPrisma().order.findFirstOrThrow({
      where: { payToken: token },
      select: { id: true, tenantId: true, amount: true, description: true, packageGuests: true },
    });
    assert.equal(await applySettlement(order, payment.id, 'pending', 'job'), false);
    assert.equal((await getPrisma().order.findUniqueOrThrow({ where: { id: order.id } })).status, 'paid');
  });

  it('dos liquidaciones simultáneas y solo una escribe', async () => {
    const token = await newOrder();
    await beginPublicPayment(token, 'https://citas.posxml.com');
    const payment = await getPrisma().payment.findFirstOrThrow();
    const order = await getPrisma().order.findFirstOrThrow({
      where: { payToken: token },
      select: { id: true, tenantId: true, amount: true, description: true, packageGuests: true },
    });

    const both = await Promise.all([
      applySettlement(order, payment.id, 'paid', 'callback'),
      applySettlement(order, payment.id, 'paid', 'job'),
    ]);
    assert.equal(both.filter(Boolean).length, 1);
    assert.equal(await getPrisma().auditLog.count({ where: { action: 'order.paid' } }), 1);
  });

  it('un aviso con una referencia inventada no encuentra nada', async () => {
    const response = await notify('999999999999');
    assert.equal(response.status, 404);
  });

  it('el repaso pregunta al proveedor con el que se abrió el cobro', async () => {
    const token = await newOrder();
    await beginPublicPayment(token, 'https://citas.posxml.com');
    const payment = await getPrisma().payment.findFirstOrThrow();
    assert.equal(payment.provider, 'whish', 'se guarda el proveedor, no «manual»');

    // Pasado el periodo de gracia.
    await getPrisma().payment.updateMany({ data: { createdAt: new Date(Date.now() - 10 * 60 * 1000) } });
    await reconcilePending();
    const second = await reconcilePending();
    assert.equal(second.paid, 1);
    assert.equal((await getPrisma().order.findFirstOrThrow({ where: { payToken: token } })).status, 'paid');
  });

  it('el efectivo no se le pregunta a nadie', async () => {
    const token = await newOrder();
    const order = await getPrisma().order.findFirstOrThrow({ where: { payToken: token } });
    await getPrisma().payment.create({
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
