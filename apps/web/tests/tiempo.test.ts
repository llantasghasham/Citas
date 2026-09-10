import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildIcs, wallClockToUtc } from '../src/lib/calendar/ics';
import { formatDate } from '../src/lib/time/display';
import { utcToZoned, zonedToUtc } from '../src/lib/time/zoned';

/**
 * Fechas, calendario y RTL. No hace falta base de datos: es todo cálculo.
 */
describe('la hora de un reloj a un instante', () => {
  it('rechaza un día que no existe, en vez de correrlo al siguiente mes', () => {
    // `Date.parse` no protesta ante un 30 de febrero: devuelve el 2 de marzo.
    // Un envío programado saldría otro día sin que nadie se enterara.
    assert.equal(zonedToUtc('2026-02-30T09:00', 'Asia/Beirut'), null);
    assert.equal(zonedToUtc('2026-04-31T19:00', 'Asia/Beirut'), null);
    assert.equal(zonedToUtc('2026-02-29T09:00', 'Asia/Beirut'), null, '2026 no es bisiesto');
    assert.equal(zonedToUtc('2026-13-01T09:00', 'Asia/Beirut'), null);
    assert.equal(zonedToUtc('2026-06-15T25:00', 'Asia/Beirut'), null);
  });

  it('rechaza lo que no es una hora de reloj, y las zonas inventadas', () => {
    assert.equal(zonedToUtc('', 'Asia/Beirut'), null);
    assert.equal(zonedToUtc('mañana', 'Asia/Beirut'), null);
    assert.equal(zonedToUtc('2026-03-03', 'Asia/Beirut'), null);
    assert.equal(zonedToUtc('2026-03-03T09:00', 'Marte/Olimpo'), null);
  });

  it('convierte con la zona, no con el reloj del servidor', () => {
    const beirut = zonedToUtc('2026-03-03T09:00', 'Asia/Beirut');
    const costaRica = zonedToUtc('2026-03-03T09:00', 'America/Costa_Rica');
    assert.ok(beirut !== null && costaRica !== null);
    assert.equal((costaRica.getTime() - beirut.getTime()) / 3600000, 8);
  });

  it('respeta el cambio de horario de verano', () => {
    // El Líbano adelanta la hora la última noche de marzo.
    assert.equal(zonedToUtc('2026-03-28T09:00', 'Asia/Beirut')?.toISOString(), '2026-03-28T07:00:00.000Z');
    assert.equal(zonedToUtc('2026-03-29T09:00', 'Asia/Beirut')?.toISOString(), '2026-03-29T06:00:00.000Z');
  });

  it('va y vuelve sin desplazarse', () => {
    for (const wall of ['2026-03-03T09:00', '2026-02-28T23:59', '2026-12-31T00:00']) {
      const instant = zonedToUtc(wall, 'Asia/Beirut');
      assert.ok(instant !== null);
      assert.equal(utcToZoned(instant, 'Asia/Beirut'), wall);
    }
  });
});

describe('el archivo de calendario', () => {
  const ics = (location: string, summary = 'Boda'): string =>
    buildIcs({
      uid: 'x@citas',
      start: wallClockToUtc('2026-03-03', '19:00', 'Asia/Beirut'),
      summary,
      description: 'Le esperamos\nen el salón',
      location,
      url: 'https://citas.posxml.com/i/x',
    });

  it('escapa el punto y coma, que rompía el archivo entero', () => {
    // `'\;'` en JavaScript es un punto y coma a secas: no se escapaba nada.
    const line = ics('Le Royal; piso 2').split('\r\n').find((l) => l.startsWith('LOCATION:'));
    assert.ok(line?.includes('\;'), line);
  });

  it('no deja ni un ; ni un , sin escapar en ningún valor de texto', () => {
    const suelto = ics('A; B, C\\D', 'Karim, Layla; y familia')
      .split('\r\n')
      .filter((line) => /^(SUMMARY|LOCATION|DESCRIPTION):/.test(line))
      .filter((line) => /(?<!\\)[;,]/.test(line.slice(line.indexOf(':') + 1)));
    assert.deepEqual(suelto, []);
  });

  it('escribe el instante en UTC, no la hora del salón', () => {
    // Las 19:00 de Beirut en marzo son las 17:00 UTC.
    assert.ok(ics('X').includes('DTSTART:20260303T170000Z'));
  });

  it('parte las líneas largas sin romper el árabe', () => {
    const largo = ics('قاعة الاحتفالات الكبرى في شارع الحمرا ببيروت لبنان الجميل جدا');
    const location = largo.split('\r\n').filter((l) => l.startsWith('LOCATION:') || l.startsWith(' '));
    assert.ok(location.length > 1, 'debería plegarse');
    assert.ok(!location.join('').includes('�'), 'no debe haber caracteres rotos');
  });
});

describe('las fechas que ve una persona', () => {
  it('salen en su zona, no en UTC', () => {
    // Una venta a las 19:30 en Costa Rica: en UTC ya es el día siguiente.
    const venta = new Date('2026-03-14T01:30:00Z');
    assert.equal(venta.toISOString().slice(0, 10), '2026-03-14');
    assert.match(formatDate(venta, 'es', 'America/Costa_Rica'), /13/);
  });

  it('salen en su idioma', () => {
    const dia = new Date('2026-03-14T12:00:00Z');
    assert.notEqual(
      formatDate(dia, 'en', 'Asia/Beirut'),
      formatDate(dia, 'ar', 'Asia/Beirut'),
    );
  });
});
