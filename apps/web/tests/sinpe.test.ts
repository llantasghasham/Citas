import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseSinpeEmail, toCents } from '../src/lib/payments/sinpe/parse';
import { plainText } from '../src/lib/payments/sinpe/text';

/**
 * El lector de avisos del banco.
 *
 * No toca la base, así que corre siempre. Y es la pieza que, si falla, INVENTA
 * DINERO: no hay pasarela que confirme nada detrás, solo esto. Cada prueba de
 * aquí es un fallo que ya ocurrió de verdad en el sistema del que viene la
 * especificación, no un caso imaginado.
 *
 * ATENCIÓN: los cuerpos de abajo están escritos SIGUIENDO la especificación,
 * no copiados de correos reales — no los tengo. Las tres trampas sí están
 * descritas al detalle y son lo que se prueba. Los patrones exactos de cada
 * banco (cómo escribe el nombre BAC, dónde pone la referencia Davivienda) hay
 * que fijarlos contra correos de verdad antes de encender esto para cobrar.
 */
describe('el lector de avisos de SINPE', () => {
  describe('trampa 1: plata que sale, no que entra', () => {
    it('un SINPE ENVIADO no es un cobro', () => {
      const leido = parseSinpeEmail(
        'Notificación de transacción',
        'Se ha realizado un débito en su cuenta por transferencia SINPE Móvil ' +
          'por ₡25.000,00. Comprobante: 2024050612345678901234567. BAC Credomatic',
      );
      assert.equal(leido.outcome, 'ignore');
      assert.equal(leido.outcome === 'ignore' ? leido.reason : '', 'outgoing');
    });

    it('se descarta ANTES que nada, aunque el correo parezca perfecto', () => {
      // Trae comprobante largo, banco y monto: pasaría todos los demás filtros.
      const leido = parseSinpeEmail(
        'SINPE Móvil',
        'Débito en su cuenta. Transferencia SINPE Móvil a JUAN PEREZ ' +
          'por ₡50.000,00. Referencia 1234567890123456789012345. Banco Nacional',
      );
      assert.equal(leido.outcome, 'ignore');
      assert.equal(leido.outcome === 'ignore' ? leido.reason : '', 'outgoing');
    });
  });

  describe('trampa 2: el mismo pago llega dos veces', () => {
    const COMPROBANTE = '2026091012345678901234567';

    it('el aviso del SINPE Móvil es el bueno: trae nombre y comprobante largo', () => {
      const leido = parseSinpeEmail(
        'SINPE Móvil',
        `Ha recibido un SINPE Móvil de MARIA FERNANDEZ ROJAS por ₡25.000,00. ` +
          `Comprobante: ${COMPROBANTE}. BAC Credomatic`,
      );
      assert.equal(leido.outcome, 'movement');
      if (leido.outcome !== 'movement') return;
      assert.equal(leido.movement.amount, 2_500_000, 'veinticinco mil colones en céntimos');
      assert.equal(leido.movement.reference, COMPROBANTE);
      assert.equal(leido.movement.senderName, 'MARIA FERNANDEZ ROJAS');
      assert.equal(leido.movement.bank, 'bac');
      assert.equal(leido.movement.movementType, 'sinpe_movil');
    });

    it('el aviso de movimiento de cuenta es el mismo dinero: no se cobra', () => {
      // Sin nombre, y con una referencia corta que es SIEMPRE la misma porque
      // identifica al aviso, no al movimiento.
      const leido = parseSinpeEmail(
        'Notificación de movimiento',
        'Le informamos que se realizó un crédito en su cuenta por ₡25.000,00. ' +
          'Referencia: 987654. BAC Credomatic',
      );
      assert.equal(leido.outcome, 'ignore');
      assert.equal(leido.outcome === 'ignore' ? leido.reason : '', 'account_notice');
    });

    it('el aviso de cuenta se ignora también cuando no trae referencia ninguna', () => {
      const leido = parseSinpeEmail(
        'Movimiento',
        'Se realizó un crédito en su cuenta por ₡25.000,00. Banco de Costa Rica',
      );
      assert.equal(leido.outcome === 'ignore' ? leido.reason : '', 'account_notice');
    });

    it('«crédito en su cuenta» con comprobante LARGO sí se cobra', () => {
      // Un banco puede escribirlo así y traer el comprobante bueno. Lo que
      // descarta al aviso repetido es la referencia corta, no la frase.
      const leido = parseSinpeEmail(
        'Movimiento',
        `Se realizó un crédito en su cuenta por SINPE de ₡10.000,00. ` +
          `Comprobante ${COMPROBANTE}. Davivienda`,
      );
      assert.equal(leido.outcome, 'movement');
      if (leido.outcome !== 'movement') return;
      assert.equal(leido.movement.amount, 1_000_000);
    });
  });

  describe('trampa 3: bancos que mandan solo HTML', () => {
    // El caso exacto de Davivienda: el monto salía del CSS y la referencia era
    // el final de la palabra «Referencia».
    const HTML =
      '<html><head><style>.fila{width:402.812px;padding:12.5px}</style>' +
      '<script>var monto = 999999;</script></head><body>' +
      '<table><tr><td>Monto:</td><td>&cent;25.000,00</td></tr>' +
      '<tr><td>Referencia</td><td>2026091099887766554433221</td></tr>' +
      '<tr><td>De:</td><td>CARLOS MENDEZ SOTO</td></tr>' +
      '<tr><td>Davivienda - SINPE M&oacute;vil</td></tr></table></body></html>';

    it('el CSS no es un monto', () => {
      const limpio = plainText(HTML);
      assert.ok(!limpio.includes('402.812'), 'la hoja de estilo se va entera');
      assert.ok(!limpio.includes('999999'), 'el script también');
    });

    it('las celdas no se pegan entre ellas', () => {
      // «Monto:» y su valor quedan en líneas distintas. Sin convertir los
      // cierres de celda en saltos, salía «Monto:¢25.000,00Referencia» y la
      // expresión del monto se llevaba por delante lo que viniera detrás.
      const limpio = plainText(HTML);
      assert.match(limpio, /Monto:\n¢25\.000,00\n/);
      assert.match(limpio, /Referencia\n2026091099887766554433221\n/);
    });

    it('las entidades se decodifican', () => {
      const limpio = plainText(HTML);
      assert.ok(limpio.includes('¢'), '&cent;');
      assert.ok(limpio.includes('Móvil'), '&oacute;');
    });

    it('y el correo entero se lee bien', () => {
      const leido = parseSinpeEmail('Notificación Davivienda', HTML);
      assert.equal(leido.outcome, 'movement');
      if (leido.outcome !== 'movement') return;
      assert.equal(leido.movement.amount, 2_500_000, 'no 40.281.200');
      assert.equal(leido.movement.reference, '2026091099887766554433221', 'no «ncia»');
      assert.equal(leido.movement.bank, 'davivienda');
    });

    it('un SMS pegado a mano se deja tal cual', () => {
      // «BNCR», no «BN» a secas: la especificación lista las palabras clave de
      // cada banco, y dos letras sueltas chocarían con demasiadas cosas.
      const sms = 'BNCR: Recibio SINPE Movil de ANA SOLIS por ¢15,000.00 ref 20260910556677889900112';
      assert.equal(plainText(sms), sms);
      const leido = parseSinpeEmail('', sms);
      assert.equal(leido.outcome, 'movement');
      if (leido.outcome !== 'movement') return;
      assert.equal(leido.movement.amount, 1_500_000);
      assert.equal(leido.movement.bank, 'bn');
    });
  });


  /**
   * El correo de verdad, copiado de la bandeja del dueño.
   *
   * Esto ya no es una suposición: es lo que manda Davivienda, y las dos cosas
   * que fallaban con él son justo las que un correo inventado no habría
   * enseñado nunca.
   */
  describe('el correo REAL de Davivienda', () => {
    const DE = 'notificaciones.gx@davivienda.cr';
    const ASUNTO = 'Recepción de pago por SINPE Móvil';
    const CUERPO =
      'Ha recibido 66,000.00 Colones de DEYNA_MARIA_GUZMAN_C por SINPE Movil. ' +
      'Comprobante 2026090910283002226510944';

    it('se lee entero', () => {
      const leido = parseSinpeEmail(ASUNTO, CUERPO, DE);
      assert.equal(leido.outcome, 'movement');
      if (leido.outcome !== 'movement') return;
      assert.equal(leido.movement.amount, 6_600_000, '₡66.000,00 en céntimos');
      assert.equal(leido.movement.reference, '2026090910283002226510944');
      assert.equal(leido.movement.movementType, 'sinpe_movil');
    });

    it('el nombre lleva el monto en medio, y guiones bajos', () => {
      // «Ha recibido 66,000.00 Colones de NOMBRE por…»: exigir que «de» fuera
      // pegado a «recibido» devolvía nulo SIEMPRE con este banco. Y el nombre
      // viene con guiones bajos, que se leen como espacios.
      const leido = parseSinpeEmail(ASUNTO, CUERPO, DE);
      assert.equal(leido.outcome, 'movement');
      if (leido.outcome !== 'movement') return;
      assert.equal(leido.movement.senderName, 'DEYNA MARIA GUZMAN C');
    });

    it('el banco solo se nombra en el remitente', () => {
      // El cuerpo no dice «Davivienda» en ninguna parte.
      assert.ok(!CUERPO.toLowerCase().includes('davivienda'));

      const conRemitente = parseSinpeEmail(ASUNTO, CUERPO, DE);
      const sinRemitente = parseSinpeEmail(ASUNTO, CUERPO);
      assert.equal(conRemitente.outcome === 'movement' ? conRemitente.movement.bank : '', 'davivienda');
      assert.equal(sinRemitente.outcome === 'movement' ? sinRemitente.movement.bank : 'x', null);
    });
  });

  describe('¿es siquiera un aviso de banco?', () => {
    it('una factura del buzón no es un SINPE', () => {
      const leido = parseSinpeEmail(
        'Su factura electrónica',
        'Adjuntamos la factura 00100001010000000123 por servicios de hosting.',
      );
      assert.equal(leido.outcome, 'ignore');
      assert.equal(leido.outcome === 'ignore' ? leido.reason : '', 'not_a_notice');
    });

    it('un boletín que hable de transferencias tampoco', () => {
      const leido = parseSinpeEmail(
        'Novedades',
        'Ahora puede hacer transferencias desde la app. Descárguela hoy.',
      );
      assert.equal(leido.outcome, 'ignore');
    });

    it('sin comprobante utilizable no se inventa un movimiento', () => {
      const leido = parseSinpeEmail(
        'SINPE',
        'Ha recibido un SINPE Móvil de ANA por ₡5.000,00. BAC',
      );
      assert.equal(leido.outcome, 'ignore', 'sin referencia no se puede casar nada');
    });

    it('sin monto tampoco', () => {
      const leido = parseSinpeEmail(
        'SINPE',
        'Ha recibido un SINPE Móvil de ANA. Comprobante 2026091012345678901234567. BAC',
      );
      assert.equal(leido.outcome, 'ignore');
    });
  });

  describe('los montos, que es donde se inventa el dinero', () => {
    it('a la costarricense y a la inglesa dan lo mismo', () => {
      assert.equal(toCents('25.000,00'), 2_500_000);
      assert.equal(toCents('25,000.00'), 2_500_000);
    });

    it('un separador con tres dígitos detrás son millares, no decimales', () => {
      assert.equal(toCents('25.000'), 2_500_000, 'veinticinco mil');
      assert.equal(toCents('25,000'), 2_500_000);
    });

    it('un separador con dos dígitos detrás son decimales', () => {
      assert.equal(toCents('25,50'), 2550);
      assert.equal(toCents('25.50'), 2550);
    });

    it('sin separador es un entero de colones', () => {
      assert.equal(toCents('25000'), 2_500_000);
    });

    it('los millares repetidos se leen enteros', () => {
      assert.equal(toCents('1.250.000,00'), 125_000_000);
      assert.equal(toCents('1,250,000.00'), 125_000_000);
    });

    it('lo que no se entiende no se adivina', () => {
      assert.equal(toCents('25.0000'), null);
      assert.equal(toCents('abc'), null);
      assert.equal(toCents(''), null);
    });

    it('un número sin marca de moneda no es un monto', () => {
      // La lección del `width:402.812px`: aunque el CSS se cuele, un número
      // suelto no se toma nunca.
      const leido = parseSinpeEmail(
        'SINPE',
        'Ha recibido un SINPE Móvil de ANA 402.812 ref 2026091012345678901234567. BAC',
      );
      assert.equal(leido.outcome, 'ignore', 'sin moneda ni etiqueta, no hay monto');
    });
  });

  describe('lo que se saca del aviso bueno', () => {
    it('el teléfono de quien paga', () => {
      const leido = parseSinpeEmail(
        'SINPE Móvil',
        'Ha recibido un SINPE Móvil de LUIS ARAYA, teléfono 8712-3456, ' +
          'por ₡7.500,00. Comprobante: 2026091011122233344455566. Banco Popular',
      );
      assert.equal(leido.outcome, 'movement');
      if (leido.outcome !== 'movement') return;
      assert.equal(leido.movement.senderPhone, '87123456');
      assert.equal(leido.movement.bank, 'popular');
    });

    it('los bancos, cada uno por su palabra', () => {
      const casos: [string, string][] = [
        ['BAC Credomatic', 'bac'],
        ['Banco Nacional de Costa Rica BNCR', 'bn'],
        ['Banco de Costa Rica', 'bcr'],
        ['Davivienda', 'davivienda'],
        ['Banco Popular', 'popular'],
        ['Promerica', 'promerica'],
        ['Scotiabank', 'scotiabank'],
        ['Lafise', 'lafise'],
        ['Banco Cathay', 'cathay'],
      ];
      for (const [nombre, esperado] of casos) {
        const leido = parseSinpeEmail(
          'SINPE Móvil',
          `Ha recibido un SINPE Móvil de ANA SOLIS por ₡1.000,00. ` +
            `Comprobante: 2026091012345678901234567. ${nombre}`,
        );
        assert.equal(leido.outcome, 'movement', nombre);
        if (leido.outcome !== 'movement') continue;
        assert.equal(leido.movement.bank, esperado, nombre);
      }
    });

    it('el mismo comprobante leído dos veces da el mismo texto', () => {
      // De esto depende toda la idempotencia: el comprobante es `providerRef`,
      // y `providerRef` es único por proveedor. Si el lector lo normalizara
      // distinto entre dos lecturas, el mismo pago entraría dos veces.
      const cuerpo =
        'Ha recibido un SINPE Móvil de ANA SOLIS por ₡1.000,00. ' +
        'Comprobante: 2026-0910-1234-5678-9012-34567. BAC';
      const uno = parseSinpeEmail('SINPE', cuerpo);
      const dos = parseSinpeEmail('SINPE', cuerpo);
      assert.equal(uno.outcome, 'movement');
      if (uno.outcome !== 'movement' || dos.outcome !== 'movement') return;
      assert.equal(uno.movement.reference, dos.movement.reference);
      assert.equal(uno.movement.reference, '2026091012345678901234567', 'sin guiones');
    });
  });
});
