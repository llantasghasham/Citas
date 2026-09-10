import { Resolver } from 'node:dns/promises';

import { setting } from '@/lib/settings';

/**
 * Si el dominio del remitente está autorizado a mandar correo.
 *
 * El servidor puede aceptar el mensaje —«250 OK», con su número de cola— y el
 * correo no llegar jamás: quien lo tira no es el que lo envía, es el que lo
 * recibe. Hotmail y Gmail descartan EN SILENCIO lo que llega de un dominio sin
 * SPF ni DMARC, y no devuelven ningún rebote. Desde este lado eso se ve
 * exactamente igual que si todo hubiera ido bien, y es la razón de esta
 * comprobación: sin ella, la única pista es «se envió y no llegó».
 *
 * DKIM se busca a TIENTAS: la firma se publica en
 * `<selector>._domainkey.<dominio>` y el selector lo elige el servidor de
 * correo, así que no hay una dirección fija donde mirar. Se prueban los
 * selectores que usan los alojamientos corrientes, y por eso no encontrarlo NO
 * demuestra que no exista — solo que no está donde se ha mirado. Se informa
 * como una pista, nunca como un fallo. SPF y DMARC sí viven en un sitio fijo.
 */
export interface SenderDns {
  /** El dominio de MAIL_FROM, que es lo que miran Hotmail y Gmail. */
  domain: string | null;
  spf: string | null;
  dmarc: string | null;
  /** El selector donde se encontró la firma, si es que se dio con alguno. */
  dkimSelector: string | null;
  /** El DNS no contestó: no es lo mismo que «no hay registro». */
  unreachable?: boolean;
}

/** «Marca <info@dominio.com>» → `dominio.com`. También acepta la dirección sola. */
export function senderDomain(from: string | undefined): string | null {
  if (from === undefined) return null;
  const inside = from.match(/<([^>]+)>/)?.[1] ?? from;
  const at = inside.trim().lastIndexOf('@');
  if (at < 0) return null;
  const domain = inside.slice(at + 1).trim().toLowerCase();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : null;
}

/** Un TXT llega troceado; se junta antes de mirarlo. */
function joined(chunks: string[][]): string[] {
  return chunks.map((parts) => parts.join(''));
}

const TIMEOUT_MS = 5000;

/**
 * Los selectores que ponen los alojamientos más comunes. `default` es el de
 * cPanel —Bluehost, HostGator—, `google` el de Workspace, `selector1` el de
 * Microsoft 365, y `k1`/`s1` los de varios servicios de envío.
 */
const DKIM_SELECTORS = ['default', 'google', 'selector1', 'k1', 's1', 'mail', 'dkim'];

/**
 * Los TXT de un nombre. Vacío significa «no hay registro», y `null` «el DNS no
 * contestó»: no son lo mismo, y confundirlos haría que un dominio sin SPF —el
 * problema que esto busca— saliera como «no se pudo comprobar».
 */
async function txt(resolver: Resolver, name: string): Promise<string[] | null> {
  try {
    return joined(await resolver.resolveTxt(name));
  } catch (error) {
    const code = (error as { code?: string }).code;
    return code === 'ENODATA' || code === 'ENOTFOUND' ? [] : null;
  }
}

export async function readSenderDns(): Promise<SenderDns> {
  const domain = senderDomain(await setting('MAIL_FROM'));
  if (domain === null) return { domain: null, spf: null, dmarc: null, dkimSelector: null };

  // Un resolvedor propio, con tiempo límite: esta consulta se hace al pintar
  // una pantalla del panel, y un DNS que no contesta no puede dejarla colgada.
  const resolver = new Resolver({ timeout: TIMEOUT_MS, tries: 1 });

  const [own, dmarcRecords] = await Promise.all([
    txt(resolver, domain),
    txt(resolver, `_dmarc.${domain}`),
  ]);

  if (own === null || dmarcRecords === null) {
    return { domain, spf: null, dmarc: null, dkimSelector: null, unreachable: true };
  }

  return {
    domain,
    spf: own.find((record) => record.toLowerCase().startsWith('v=spf1')) ?? null,
    dmarc: dmarcRecords.find((record) => record.toLowerCase().startsWith('v=dmarc1')) ?? null,
    dkimSelector: await findDkim(resolver, domain),
  };
}

/** El primer selector con una clave publicada, o nada si no se dio con ninguno. */
async function findDkim(resolver: Resolver, domain: string): Promise<string | null> {
  const found = await Promise.all(
    DKIM_SELECTORS.map(async (selector) => {
      const records = await txt(resolver, `${selector}._domainkey.${domain}`);
      const has = (records ?? []).some((record) => record.toLowerCase().includes('v=dkim1'));
      return has ? selector : null;
    }),
  );
  return found.find((selector) => selector !== null) ?? null;
}
