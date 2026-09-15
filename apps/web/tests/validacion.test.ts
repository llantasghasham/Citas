import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { draftProblems, EMPTY_DRAFT } from '../src/lib/create/draft';
import { buildCsv } from '../src/lib/export/csv';
import { displayName } from '../src/components/panel/UserMenu';
import { renderOnce, renderingNow } from '../src/lib/render/once';
import { allowedForCapture, captureUrl, renderOrigin } from '../src/lib/render/origin';
import { isCalendarDate, isClockTime } from '../src/lib/time/zoned';
import { findVerse, listVerses, unverifiedVerses } from '../src/lib/verses';
import { senderDomain } from '../src/lib/mail/dns';
import { isEmailAddress, mailFromAddress, mailFromProblem } from '../src/lib/mail/from';
import { MailNotSentError } from '../src/lib/mail/types';
import { smtpMailer } from '../src/lib/mail/smtp';
import { getMailer } from '../src/lib/mail';
import { resendMailer } from '../src/lib/mail/resend';

/**
 * Lo que se comprueba ANTES de publicar, y lo que sale en una exportación.
 *
 * No toca la base, así que corre siempre. Las dos cosas de aquí llegaron por un
 * informe externo y las dos eran ciertas.
 */
describe('la fecha tiene que existir en el calendario', () => {
  it('un 30 de febrero no es una fecha', () => {
    // Tenía la forma correcta y pasaba. Y lo que venía detrás no protestaba:
    // `new Date('2026-02-30')` es el 2 de marzo, así que la invitación se
    // publicaba con una fecha y su `.ics` llevaba otra.
    assert.equal(isCalendarDate('2026-02-30'), false);
    assert.equal(new Date('2026-02-30T00:00:00Z').getUTCMonth(), 2, 'marzo: el salto era real');
  });

  it('ni un 31 de abril, ni un 29 de febrero de un año que no es bisiesto', () => {
    assert.equal(isCalendarDate('2026-04-31'), false);
    assert.equal(isCalendarDate('2026-02-29'), false);
    assert.equal(isCalendarDate('2024-02-29'), true, '2024 sí es bisiesto');
  });

  it('las fechas de verdad pasan', () => {
    for (const fecha of ['2026-01-01', '2026-12-31', '2026-02-28', '2028-02-29']) {
      assert.equal(isCalendarDate(fecha), true, fecha);
    }
  });

  it('lo que no tiene forma de fecha tampoco', () => {
    for (const mal of ['', '2026-1-1', '26-01-01', '2026/01/01', 'ayer', '2026-13-01', '2026-00-10']) {
      assert.equal(isCalendarDate(mal), false, mal);
    }
  });

  it('la hora es de veinticuatro horas', () => {
    assert.equal(isClockTime('19:00'), true);
    assert.equal(isClockTime('00:00'), true);
    assert.equal(isClockTime('23:59'), true);
    assert.equal(isClockTime('24:00'), false);
    assert.equal(isClockTime('19:60'), false);
    assert.equal(isClockTime('7:00'), false);
  });

  it('publicar un 30 de febrero se rechaza en el mismo sitio que todo lo demás', () => {
    // `publishDraft` llama a `draftProblems`, así que arreglarlo aquí lo
    // arregla también al publicar: un solo validador, no dos criterios.
    const draft = {
      ...EMPTY_DRAFT,
      honorees: ['ليلى', 'كريم'],
      date: '2026-02-30',
      time: '19:00',
      venueName: 'Le Royal',
      venueAddress: 'Beirut',
    };
    assert.ok(draftProblems(draft).includes('date'));

    const bueno = { ...draft, date: '2026-03-30' };
    assert.ok(!draftProblems(bueno).includes('date'));
  });
});

describe('la exportación no puede llevar fórmulas', () => {
  it('una celda que empieza por = se neutraliza', () => {
    // El nombre lo escribe cualquiera: el formulario de confirmación es
    // público a propósito. Un nombre con una fórmula dentro convierte la lista
    // de la boda en una hoja que filtra los datos del cliente con un clic.
    const csv = buildCsv(['name'], [['=HYPERLINK("https://malo.example","clic")']]);
    assert.ok(csv.includes(`"'=HYPERLINK`), 'con apóstrofo delante');
    assert.ok(!csv.includes('"=HYPERLINK'), 'nunca sin él');
  });

  it('también con espacios delante, y con + - @', () => {
    for (const peligroso of ['  =1+1', '+1', '-1+1', '@SUM(A1)', '\t=1']) {
      const csv = buildCsv(['x'], [[peligroso]]);
      assert.ok(csv.includes(`"'`), peligroso);
    }
  });

  it('un teléfono con prefijo se queda como texto, que es lo que se quiere', () => {
    // Excel trata `+50688887777` como una fórmula y se come el signo. Con el
    // apóstrofo se lee tal cual, que es lo que hace falta para un teléfono.
    const csv = buildCsv(['phone'], [['+50688887777']]);
    assert.ok(csv.includes(`"'+50688887777"`));
  });

  it('un número no se neutraliza: la columna tiene que poder sumarse', () => {
    const csv = buildCsv(['party'], [[4], [-1]]);
    assert.ok(csv.includes('"4"'));
    assert.ok(csv.includes('"-1"'), 'sin apóstrofo');
    assert.ok(!csv.includes(`"'-1"`));
  });

  it('el árabe y la marca de orden de bytes siguen intactos', () => {
    const csv = buildCsv(['name'], [['نادية الحاج']]);
    assert.equal(csv.codePointAt(0), 0xfeff, 'sin esto Excel destroza el árabe');
    assert.ok(csv.includes('نادية الحاج'));
  });
});

describe('a dónde puede navegar Chromium al hacer la foto', () => {
  it('solo al origen interno', () => {
    const origen = 'http://127.0.0.1:3000';
    assert.equal(allowedForCapture('http://127.0.0.1:3000/render/boda', origen), true);
    assert.equal(allowedForCapture('http://127.0.0.1:3000/fonts/Amiri-400.ttf', origen), true);
  });

  it('y a nada más', () => {
    // Todo esto era alcanzable: la dirección salía de `request.url`, que Next
    // arma con la cabecera `Host` — y esa la escribe quien llama.
    const origen = 'http://127.0.0.1:3000';
    for (const fuera of [
      'http://atacante.example/render/boda',
      'https://atacante.example/render/boda',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5:8080/admin',
      'http://192.168.1.1/',
      'http://[::1]:3000/render/boda',
      'http://127.0.0.1:9200/_cluster/health',
      'http://localhost:3000/render/boda',
      'file:///etc/passwd',
      'no es una url',
      '',
    ]) {
      assert.equal(allowedForCapture(fuera, origen), false, fuera);
    }
  });

  it('la dirección del lienzo no depende de la petición', () => {
    // Es lo único que cierra el agujero de raíz: por muy hostil que venga la
    // cabecera, esta función no la mira.
    const url = new URL(captureUrl('boda-de-laila'));
    assert.equal(url.origin, renderOrigin());
    assert.equal(url.pathname, '/render/boda-de-laila');
  });

  it('un slug con barras no se sale de su ruta', () => {
    const url = new URL(captureUrl('../../etc/passwd'));
    assert.equal(url.origin, renderOrigin());
    assert.ok(url.pathname.startsWith('/render/'), url.pathname);
  });
});

describe('doscientos invitados abriendo la misma invitación', () => {
  it('se dibuja UNA vez, no doscientas', async () => {
    // El caso normal, no el raro: la invitación se reenvía a un grupo y la
    // abren todos en el mismo minuto — y la primera vez ninguna está en caché.
    let veces = 0;
    const dibujar = async (): Promise<Uint8Array<ArrayBuffer>> => {
      veces += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return new Uint8Array(new ArrayBuffer(4));
    };

    const todas = await Promise.all(
      Array.from({ length: 200 }, () => renderOnce('version-1:huella-a', dibujar)),
    );

    assert.equal(veces, 1, 'un solo Chromium');
    assert.equal(todas.length, 200, 'y todas reciben su imagen');
  });

  it('dos versiones distintas no se estorban', async () => {
    let veces = 0;
    const dibujar = async (): Promise<Uint8Array<ArrayBuffer>> => {
      veces += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Uint8Array(new ArrayBuffer(4));
    };

    await Promise.all([
      renderOnce('version-2:huella-a', dibujar),
      renderOnce('version-3:huella-a', dibujar),
    ]);
    assert.equal(veces, 2);
  });

  it('nunca hay más de dos dibujándose a la vez', async () => {
    let ahora = 0;
    let maximo = 0;
    const dibujar = async (): Promise<Uint8Array<ArrayBuffer>> => {
      ahora += 1;
      maximo = Math.max(maximo, ahora);
      await new Promise((resolve) => setTimeout(resolve, 30));
      ahora -= 1;
      return new Uint8Array(new ArrayBuffer(4));
    };

    await Promise.all(
      Array.from({ length: 10 }, (_, index) => renderOnce(`version-c${index}:h`, dibujar)),
    );
    assert.ok(maximo <= 2, `llegaron a dibujarse ${maximo} a la vez`);
  });

  it('si el dibujo falla, la siguiente petición vuelve a intentarlo', async () => {
    // Sin soltar la entrada del mapa, un fallo dejaría esa invitación sin poder
    // renderizarse nunca más mientras viviera el proceso.
    let veces = 0;
    const roto = (): Promise<Uint8Array<ArrayBuffer>> => {
      veces += 1;
      return Promise.reject(new Error('Chromium no arrancó'));
    };

    await assert.rejects(renderOnce('version-4:huella-a', roto));
    await assert.rejects(renderOnce('version-4:huella-a', roto));
    assert.equal(veces, 2);
    assert.equal(renderingNow().inFlight, 0, 'el mapa queda limpio');
  });
});

describe('cómo se llama a quien está dentro', () => {
  it('su nombre, cuando lo ha escrito', () => {
    assert.equal(displayName('Moufid Ghasham', 'm@example.com'), 'Moufid Ghasham');
  });

  it('«Superadmin» no es un nombre: lo puso un script', () => {
    // Es la etiqueta de un puesto. Verla en la cabecera de tu propio panel es
    // como si tu correo te saludara llamándote «usuario».
    assert.equal(displayName('Superadmin', 'moufid@example.com'), 'moufid');
    assert.equal(displayName('superadmin', 'moufid@example.com'), 'moufid');
    assert.equal(displayName('Administrador', 'moufid@example.com'), 'moufid');
  });

  it('sin nombre, la parte local del correo — que al menos es suya', () => {
    assert.equal(displayName(null, 'moufid@example.com'), 'moufid');
    assert.equal(displayName('   ', 'moufid@example.com'), 'moufid');
  });

  it('un nombre que EMPIEZA por «admin» sí es un nombre', () => {
    assert.equal(displayName('Admina Salomé', 'x@example.com'), 'Admina Salomé');
  });
});

/**
 * Los textos sagrados.
 *
 * La regla del proyecto siempre dijo que un versículo solo se añade tras
 * verificación humana contra la edición citada. Lo que no hacía nadie era
 * aplicarla: la pantalla de salud los contaba en rojo y el resto del programa
 * los ofrecía y los imprimía igual. Un versículo coránico mal citado en la
 * invitación de una boda no es una errata que arregle el despliegue siguiente:
 * ya se reenvió al grupo de la familia.
 */
describe('un versículo sin verificar no existe para el programa', () => {
  it('no se ofrece al crear una invitación', () => {
    for (const locale of ['ar', 'es', 'pt', 'en'] as const) {
      for (const verse of listVerses(locale)) {
        assert.ok(
          verse.verifiedBy !== null && verse.verifiedBy.trim().length > 0,
          `${verse.id} se está ofreciendo sin verificar`,
        );
      }
    }
  });

  it('y no se encuentra para pintarlo', () => {
    for (const verse of unverifiedVerses()) {
      assert.equal(
        findVerse(verse.id),
        undefined,
        `${verse.id} se pintaría en una invitación sin estar verificado`,
      );
    }
  });

  it('un nombre en blanco no cuenta como verificación', () => {
    // «verifiedBy: "  "» es lo que escribe quien quiere quitarse el aviso de
    // encima sin hacer el trabajo.
    assert.equal(
      unverifiedVerses().every((verse) => findVerse(verse.id) === undefined),
      true,
    );
  });
});

/**
 * El REMITENTE del correo.
 *
 * Esta prueba existe por un caso real y caro de diagnosticar: en el campo
 * «Remitente» se escribió el nombre de la marca a secas —«POSFactura»—, la
 * pantalla lo guardó, el servidor contestó «250 OK» con su número de cola, y el
 * correo no llegó nunca. Lo que sale con ese valor es un mensaje SIN cabecera
 * `From:` y con el sobre vacío, que Hotmail y Gmail descartan en silencio.
 */
describe('el remitente del correo', () => {
  it('el nombre de la marca a secas NO es un remitente', () => {
    assert.equal(mailFromProblem('POSFactura'), 'noAddress');
    assert.equal(mailFromProblem('Citas'), 'noAddress');
    assert.equal(mailFromProblem(''), 'missing');
    assert.equal(mailFromProblem('   '), 'missing');
    assert.equal(mailFromProblem(undefined), 'missing');
    // Con arroba pero sin dominio de verdad tampoco.
    assert.equal(mailFromProblem('info@localhost'), 'badAddress');
    assert.equal(mailFromProblem('Marca <info@>'), 'badAddress');
  });

  it('con dirección, sola o entre ángulos, está bien', () => {
    assert.equal(mailFromProblem('info@posfacturacr.com'), null);
    assert.equal(mailFromProblem('POSFactura <info@posfacturacr.com>'), null);
    assert.equal(mailFromProblem('  Citas <hola@citas.example>  '), null);
  });

  it('la dirección se saca de dentro de los ángulos', () => {
    assert.equal(mailFromAddress('POSFactura <info@posfacturacr.com>'), 'info@posfacturacr.com');
    assert.equal(mailFromAddress('info@posfacturacr.com'), 'info@posfacturacr.com');
    // Y sin dirección no se inventa ninguna.
    assert.equal(mailFromAddress('POSFactura'), null);
  });

  it('el dominio que miran Hotmail y Gmail sale del remitente', () => {
    // `senderDomain` es lo que alimenta la comprobación de SPF y DMARC: con un
    // remitente sin dirección no hay dominio que comprobar, y esa fila del panel
    // se quedaba en ámbar sin explicar la causa de verdad.
    assert.equal(senderDomain('POSFactura <info@posfacturacr.com>'), 'posfacturacr.com');
    assert.equal(senderDomain('POSFactura'), null);
  });

  it('el destinatario de la prueba se comprueba: es lo que sale del dominio', () => {
    // El campo de «enviar la prueba a» viaja en un formulario, así que es un
    // dato del cliente: el `type="email"` del navegador es una comodidad para
    // quien escribe, no una barrera. Lo que decide a dónde sale un correo desde
    // el dominio de la oficina se comprueba en el servidor.
    assert.equal(isEmailAddress('autolavadoelpana@hotmail.com'), true);
    assert.equal(isEmailAddress('  info@posfacturacr.com  '), true, 'los espacios no cuentan');
    assert.equal(isEmailAddress('POSFactura'), false);
    assert.equal(isEmailAddress('info@localhost'), false, 'sin dominio de verdad no sale');
    assert.equal(isEmailAddress(''), false);
    // Y nada de meter dos en uno: una coma o un espacio abriría la puerta a una
    // lista de destinatarios en un campo pensado para uno.
    assert.equal(isEmailAddress('a@b.com, c@d.com'), false);
    assert.equal(isEmailAddress('a@b.com c@d.com'), false);
  });

  it('un remitente sin dirección se para AQUÍ, y el error lo dice', async () => {
    // Lo que se fija no es que falle —eso ya se comprobaba— sino QUIÉN dice que
    // no. La pantalla pintaba todo fallo como «El servidor de correo lo
    // rechazó. Su respuesta, tal cual: …», y este mensaje no es la respuesta de
    // nadie: es nuestro, decidido antes de abrir la conexión. Con esa frase
    // delante, un campo mal escrito en el propio panel manda a revisar el
    // Bluehost de alguien durante un día.
    process.env['MAILER'] = 'smtp';
    process.env['MAIL_FROM'] = 'POSFactura';
    await assert.rejects(
      () => smtpMailer.send({ to: 'x@example.com', subject: 's', text: 't' }),
      (error: unknown) => {
        assert.ok(error instanceof MailNotSentError, 'tiene que ir marcado como «no salió de aquí»');
        // Y lleva dentro LO QUE HAY GUARDADO, no el ejemplo: la fila de
        // `/panel/sistema` enseñaba el formato en la columna del valor y se
        // leía como «su instalación está por defecto».
        assert.match(error.message, /POSFactura/);
        return true;
      },
    );
    delete process.env['MAIL_FROM'];
    delete process.env['MAILER'];
  });
});

/**
 * El SEGUNDO emisor.
 *
 * Existe por una razón que no está en este repositorio y conviene no perder: el
 * SMTP funciona —Gmail pone el mensaje en la bandeja de entrada, con SPF, DKIM
 * y DMARC en regla— y aun así Hotmail lo descarta, por la reputación que
 * Microsoft le tiene a las IP compartidas del alojamiento. Eso no se arregla
 * con código: se deja de usar esa puerta.
 */
describe('el emisor de correo se elige, y no hay respaldo automático', () => {
  const limpiar = (): void => {
    delete process.env['MAILER'];
    delete process.env['MAIL_FROM'];
    delete process.env['RESEND_API_KEY'];
    delete process.env['RESEND_API_KEY_ENC'];
  };

  it('cada valor de MAILER da SU emisor, y lo desconocido no manda nada', async () => {
    process.env['MAILER'] = 'smtp';
    assert.equal((await getMailer()).id, 'smtp');
    process.env['MAILER'] = 'resend';
    assert.equal((await getMailer()).id, 'resend');
    // Lo que no se reconoce cae al de consola, que en producción se NIEGA a
    // correr: un código de acceso no se «entrega» en un archivo de registro.
    process.env['MAILER'] = 'sendgrid';
    assert.equal((await getMailer()).id, 'console');
    delete process.env['MAILER'];
    assert.equal((await getMailer()).id, 'console');
    limpiar();
  });

  it('sin clave de Resend NO sale, y el error dice que es cosa nuestra', async () => {
    process.env['MAILER'] = 'resend';
    process.env['MAIL_FROM'] = 'POSFactura <info@posfacturacr.com>';
    await assert.rejects(
      () => resendMailer.send({ to: 'x@example.com', subject: 's', text: 't' }),
      (error: unknown) => {
        // MARCADO: lo paramos aquí, sin llamar a nadie. Si esto saliera como un
        // error corriente, la pantalla diría «el proveedor lo rechazó» sobre
        // algo que el proveedor no ha visto — el mismo fallo que ya costó
        // mandar a revisar un Bluehost ajeno.
        assert.ok(error instanceof MailNotSentError, 'tiene que ir marcado como «no salió de aquí»');
        assert.match(error.message, /Resend/);
        // Y nombra lo que hay que hacer FUERA del panel, que es lo que nadie
        // adivina: verificar el dominio.
        assert.match(error.message, /posfacturacr\.com/);
        return true;
      },
    );
    limpiar();
  });

  it('Resend exige el mismo remitente que el SMTP, con el valor guardado dentro', async () => {
    process.env['MAILER'] = 'resend';
    process.env['MAIL_FROM'] = 'POSFactura';
    await assert.rejects(
      () => resendMailer.send({ to: 'x@example.com', subject: 's', text: 't' }),
      (error: unknown) => {
        assert.ok(error instanceof MailNotSentError);
        // El valor guardado, nunca el ejemplo: es la misma regla que la fila de
        // `/panel/sistema`, y por los dos emisores.
        assert.match(error.message, /POSFactura/);
        return true;
      },
    );
    limpiar();
  });
});
