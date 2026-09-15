import { redirect } from 'next/navigation';

import { getAdminContext } from '@/lib/admin/context';
import { auditPage, AUDIT_AREAS, type AuditArea } from '@/lib/audit/history';
import { getSession, sessionCan } from '@/lib/auth/session';
import { controlDb } from '@/lib/db/client';
import { formatDateTime } from '@/lib/time/display';
import { actorTimezone } from '@/lib/time/actor';
import { displayFont, latinOnly } from '@/lib/typography';
import { displayName } from '@/components/panel/UserMenu';

/** Cuántas por página. Suficientes para buscar sin tener que paginar por todo. */
const POR_PAGINA = 50;

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Lo que se anotó, en una línea. Nunca lleva un secreto: ver `history.ts`. */
function detalle(metadata: unknown): string {
  if (metadata === null || metadata === undefined) return '';
  if (typeof metadata !== 'object') return String(metadata);
  return Object.entries(metadata as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join(' · ');
}

/**
 * Cuánto detalle se enseña antes de plegar el resto.
 *
 * Una prueba de correo anota el recibo entero del servidor —`250 OK id=…`, el
 * remitente, los aceptados— y son cinco líneas que empujan todas las demás
 * columnas. Leer un historial es recorrerlo con la vista, y una fila que ocupa
 * lo que cinco hace justo lo contrario.
 *
 * SE PLIEGA, NO SE RECORTA. El resto sigue ahí, a un clic, dentro de un
 * `<details>` sin JavaScript de cliente: un historial que esconde parte de lo
 * que guardó no sirve para lo único que sirve un historial, que es que alguien
 * pueda comprobar qué pasó de verdad. El identificador que da el servidor de
 * correo es justo lo que hace falta el día que alguien diga que no le llegó.
 */
const DETALLE_CORTO = 120;

/**
 * EL HISTORIAL: quién hizo qué, cuándo y desde dónde.
 *
 * Los datos ya se guardaban —setenta y cuatro acciones distintas, desde el
 * primer día— y no había dónde verlos. Un registro que solo se lee con un
 * cliente de PostgreSQL no se lee nunca, y la primera vez que hace falta es el
 * día que alguien pregunta quién cambió la cuenta a la que va el dinero.
 *
 * QUIÉN VE QUÉ, y las dos reglas son distintas:
 *
 *   · Con `platform:manage` se ve TODO, de todas las oficinas, con la IP.
 *   · Con `tenant:manage` se ve SOLO lo de la propia oficina y SIN la IP. Quien
 *     administra una agencia no necesita saber desde qué casa se conectó su
 *     operadora un domingo, y el recorte se hace al CONSULTAR y no al pintar.
 *
 * Quien no tenga ninguna de las dos no entra. Se comprueba aquí, en el
 * servidor: esconder un enlace no es un permiso.
 *
 * SOLO LECTURA, y no por falta de tiempo. No hay forma de editar ni de borrar
 * una línea desde ninguna pantalla — un historial que se puede corregir no
 * sirve para lo único que sirve un historial.
 */
export default async function HistorialPage({ searchParams }: PageProps) {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  const platform = sessionCan(session, 'platform:manage');
  const ownOffice = sessionCan(session, 'tenant:manage');
  if (!platform && !ownOffice) redirect('/panel');

  const params = await searchParams;
  const uno = (name: string): string | undefined => {
    const value = params[name];
    return Array.isArray(value) ? value[0] : value;
  };

  const { dictionary, locale } = await getAdminContext(session.tenantId);
  const copy = dictionary.admin.history;
  const zone = await actorTimezone(session);

  const area = AUDIT_AREAS.find((one) => one === uno('a')) as AuditArea | undefined;

  // La oficina: la plataforma puede elegir; quien administra una oficina se
  // queda en la suya SIEMPRE. El parámetro de la dirección no decide eso — es
  // un dato del cliente, y aquí decide la sesión.
  const pedida = uno('o');
  const tenantId = platform ? (pedida === undefined || pedida === '' ? null : pedida) : session.tenantId;

  const desde = uno('d');
  const before = desde === undefined ? undefined : new Date(desde);
  const validBefore = before !== undefined && !Number.isNaN(before.getTime()) ? before : undefined;

  const { rows, next } = await auditPage({
    tenantId,
    area,
    limit: POR_PAGINA,
    before: validBefore,
    withIp: platform,
  });

  // Para el desplegable de oficinas, solo si se pueden ver todas.
  const offices = platform
    ? await controlDb().tenant.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })
    : [];

  const conFiltros = (extra: Record<string, string | undefined>): string => {
    const q = new URLSearchParams();
    if (area !== undefined) q.set('a', area);
    if (platform && tenantId !== null) q.set('o', tenantId);
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) q.delete(k);
      else q.set(k, v);
    }
    const s = q.toString();
    return s.length === 0 ? '/panel/historial' : `/panel/historial?${s}`;
  };

  const CHIP = 'border px-3 py-1.5 text-sm';
  const ACTIVO = `${CHIP} border-[#23201a] bg-[#23201a] text-[#f4efe6]`;
  const SUELTO = `${CHIP} border-[#ddd6c6] text-[#23201a] hover:border-[#23201a]`;

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className={`${displayFont(locale)} text-3xl`}>{copy.title}</h1>
        <p className="max-w-2xl text-sm text-[#6a6456]">{copy.intro}</p>
      </header>

      {/* Los filtros son ENLACES, no un formulario con JavaScript: así una
          búsqueda concreta se puede pasar a otra persona pegando la dirección,
          por la misma razón que la vista previa de «qué ve este invitado». */}
      <nav className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs ${latinOnly(locale, 'uppercase')} text-[#6a6456]`}>{copy.area}</span>
          <a href={conFiltros({ a: undefined, d: undefined })} className={area === undefined ? ACTIVO : SUELTO}>
            {copy.all}
          </a>
          {AUDIT_AREAS.map((one) => (
            <a
              key={one}
              href={conFiltros({ a: one, d: undefined })}
              className={area === one ? ACTIVO : SUELTO}
            >
              {copy.areas[one]}
            </a>
          ))}
        </div>

        {platform && offices.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs ${latinOnly(locale, 'uppercase')} text-[#6a6456]`}>{copy.office}</span>
            <a href={conFiltros({ o: undefined, d: undefined })} className={tenantId === null ? ACTIVO : SUELTO}>
              {copy.allOffices}
            </a>
            {offices.map((office) => (
              <a
                key={office.id}
                href={conFiltros({ o: office.id, d: undefined })}
                className={tenantId === office.id ? ACTIVO : SUELTO}
              >
                {office.name}
              </a>
            ))}
          </div>
        ) : null}
      </nav>

      {rows.length === 0 ? (
        <p className="text-sm text-[#6a6456]">{copy.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-3xl border-collapse text-sm">
            <thead>
              <tr
                className={`border-b border-[#ddd6c6] text-start text-xs ${latinOnly(locale, 'uppercase')} text-[#6a6456]`}
              >
                <th className="py-2 pe-4 text-start font-normal">{copy.when}</th>
                <th className="py-2 pe-4 text-start font-normal">{copy.who}</th>
                <th className="py-2 pe-4 text-start font-normal">{copy.what}</th>
                <th className="py-2 pe-4 text-start font-normal">{copy.detail}</th>
                {platform ? <th className="py-2 text-start font-normal">{copy.from}</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-[#efe9dc] align-top">
                  <td className="whitespace-nowrap py-2 pe-4 text-[#6a6456]">
                    {formatDateTime(row.at, locale, zone)}
                  </td>
                  <td className="py-2 pe-4">
                    <span className="block">
                      {row.actor === null ? copy.automatic : displayName(row.actor.name, row.actor.email)}
                    </span>
                    <span className="block text-xs text-[#6a6456]">
                      {row.tenant?.name ?? copy.platform}
                    </span>
                  </td>
                  <td className="py-2 pe-4">
                    <span className="block">{copy.areas[row.area]}</span>
                    {/* El código EXACTO, sin traducir: es el dato preciso, y
                        traducir setenta y cuatro acciones sería un «undefined»
                        el día que alguien añada la setenta y cinco. */}
                    <span className="block font-mono text-xs text-[#6a6456]" dir="ltr">
                      {row.action}
                    </span>
                  </td>
                  <td className="py-2 pe-4 text-xs text-[#6a6456]">
                    {detalle(row.metadata).length > DETALLE_CORTO ? (
                      <details className="block">
                        <summary className="cursor-pointer font-mono" dir="ltr">
                          {`${detalle(row.metadata).slice(0, DETALLE_CORTO)}…`}
                        </summary>
                        <span className="mt-1 block font-mono break-all" dir="ltr">
                          {detalle(row.metadata)}
                        </span>
                      </details>
                    ) : (
                      <span className="block font-mono" dir="ltr">
                        {detalle(row.metadata)}
                      </span>
                    )}
                    <span className="block font-mono opacity-60" dir="ltr">
                      {row.entity} {row.entityId}
                    </span>
                  </td>
                  {platform ? (
                    <td className="whitespace-nowrap py-2 font-mono text-xs text-[#6a6456]" dir="ltr">
                      {row.ip ?? copy.noIp}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Se pagina por FECHA y no por número de página: esta tabla crece
          mientras se mira, y con `skip` la página dos repetiría lo de la uno. */}
      {next !== null ? (
        <a href={conFiltros({ d: next.toISOString() })} className={`self-start ${SUELTO}`}>
          {copy.more}
        </a>
      ) : null}
    </>
  );
}
