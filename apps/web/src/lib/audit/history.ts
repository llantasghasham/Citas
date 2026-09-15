import { AUDIT_AREAS, type AuditAreaName } from '@citas/core';

import { controlDb } from '@/lib/db/client';

/**
 * El historial, para leerlo.
 *
 * Escribirlo ya lo hacía `recordAudit` desde el principio, y lo escribe MUCHO:
 * setenta y cuatro acciones distintas —quién entró, quién cobró, quién cambió
 * la configuración, quién apuntó una entrada en la puerta, quién borró la foto
 * de un proveedor—. Lo que no había era dónde verlo. Un registro que solo se
 * puede leer con un cliente de PostgreSQL es un registro que no se lee, y
 * entonces no protege de nada: la primera vez que hace falta es el día que
 * alguien pregunta «¿quién cambió la cuenta a la que va el dinero?».
 *
 * VIVE EN EL PLANO DE CONTROL, como dice la frontera: el historial es del
 * arrendador. `lint:planes` lo comprueba.
 */

/**
 * Las ÁREAS, que son una lista cerrada y traducida.
 *
 * Aquí había dos caminos y el otro era peor. Traducir las setenta y cuatro
 * acciones a cuatro idiomas son casi trescientas frases, y el día que alguien
 * añada una acción nueva —que es todas las semanas— la pantalla diría
 * «undefined» en el registro de una oficina real. Es exactamente el fallo que
 * la prueba de las categorías del directorio existe para atrapar.
 *
 * Así que se traduce el ÁREA, que es una lista cerrada de siete, y al lado se
 * enseña el código exacto de la acción en monoespaciado. Es además lo que hace
 * una pantalla de auditoría de verdad: el código preciso es el dato, y el área
 * es para poder filtrar. Una acción nueva cae sola en su área por el prefijo, y
 * una de un prefijo que nadie previó cae en «otros» — nunca en la nada.
 */
export { AUDIT_AREAS };
export type AuditArea = AuditAreaName;

/** Qué prefijo pertenece a qué área. El orden no importa; las claves, sí. */
const AREA_OF_PREFIX: Record<string, AuditArea> = {
  auth: 'access',

  order: 'money',
  sinpe: 'money',

  act: 'event',
  event: 'event',
  guests: 'event',
  segment: 'event',
  table: 'event',
  checkin: 'event',

  whatsapp: 'messaging',
  consent: 'messaging',

  directory: 'directory',
  provider: 'directory',
  listing: 'directory',

  system: 'system',
  tenant: 'system',
  retention: 'system',
};

/** El área de una acción, por su prefijo. Lo que no encaja es «otros». */
export function areaOf(action: string): AuditArea {
  const prefix = action.split('.')[0] ?? '';
  return AREA_OF_PREFIX[prefix] ?? 'other';
}

/** Una línea del historial, ya lista para pintar. */
export interface AuditRow {
  id: string;
  at: Date;
  action: string;
  area: AuditArea;
  entity: string;
  entityId: string;
  /** Quién lo hizo. `null` cuando lo hizo un trabajo automático. */
  actor: { name: string | null; email: string } | null;
  /** De qué oficina. `null` en lo que es de la plataforma. */
  tenant: { id: string; name: string } | null;
  /**
   * Lo que se anotó. Por construcción NUNCA lleva un secreto: la regla de la
   * casa es que del cambio de configuración se anota QUÉ campos cambiaron y
   * jamás su valor, y que de un permiso se anotan los últimos dígitos del
   * teléfono y nunca el contacto entero.
   */
  metadata: unknown;
  /**
   * Desde dónde. Solo se entrega a quien administra la PLATAFORMA: es un dato
   * personal de quien trabaja en una oficina, y quien administra esa oficina no
   * necesita saber desde qué casa se conectó su operadora un domingo.
   */
  ip: string | null;
}

export interface AuditQuery {
  /** `null` = todas las oficinas. Solo la plataforma puede pedir eso. */
  tenantId: string | null;
  area?: AuditArea | undefined;
  /** Cuántas traer. Una más se pide por dentro para saber si hay otra página. */
  limit: number;
  /** Desde qué fila seguir, para la página siguiente. */
  before?: Date | undefined;
  /** Si se entrega la IP. */
  withIp: boolean;
}

export interface AuditPage {
  rows: AuditRow[];
  /** La marca de tiempo por la que pedir la página siguiente, o `null`. */
  next: Date | null;
}

/**
 * Una página del historial, de lo más nuevo a lo más viejo.
 *
 * Se pagina por FECHA y no por número de página, y la razón es que esta tabla
 * crece mientras se mira: con `skip` cada línea nueva empuja a las demás y la
 * página dos repetiría lo que ya salió en la uno.
 */
export async function auditPage(query: AuditQuery): Promise<AuditPage> {
  const prefixes =
    query.area === undefined
      ? null
      : Object.entries(AREA_OF_PREFIX)
          .filter(([, area]) => area === query.area)
          .map(([prefix]) => prefix);

  const rows = await controlDb().auditLog.findMany({
    where: {
      // `undefined` es «no filtres»; `null` en `tenantId` significaría «solo lo
      // que no es de ninguna oficina», que es otra cosa muy distinta.
      ...(query.tenantId === null ? {} : { tenantId: query.tenantId }),
      ...(query.before === undefined ? {} : { createdAt: { lt: query.before } }),
      // El área se filtra en la BASE y no después de traer: filtrando en
      // memoria, una página de cincuenta podría quedarse en tres.
      ...(prefixes === null || prefixes.length === 0
        ? {}
        : { OR: prefixes.map((prefix) => ({ action: { startsWith: `${prefix}.` } })) }),
    },
    orderBy: { createdAt: 'desc' },
    // Una de más: es cómo se sabe que hay página siguiente sin contar la tabla
    // entera, que en un historial de un año es una consulta cara y para nada.
    take: query.limit + 1,
    select: {
      id: true,
      createdAt: true,
      action: true,
      entity: true,
      entityId: true,
      metadata: true,
      ip: true,
      actor: { select: { name: true, email: true } },
      tenant: { select: { id: true, name: true } },
    },
  });

  const hayMas = rows.length > query.limit;
  const visibles = hayMas ? rows.slice(0, query.limit) : rows;

  return {
    rows: visibles.map((row) => ({
      id: row.id,
      at: row.createdAt,
      action: row.action,
      area: areaOf(row.action),
      entity: row.entity,
      entityId: row.entityId,
      actor: row.actor === null ? null : { name: row.actor.name, email: row.actor.email },
      tenant: row.tenant === null ? null : { id: row.tenant.id, name: row.tenant.name },
      metadata: row.metadata,
      // Se RECORTA aquí y no en la pantalla: una decisión sobre datos
      // personales que dependa de que una plantilla se acuerde de no pintar un
      // campo es una decisión que un día se olvida.
      ip: query.withIp ? row.ip : null,
    })),
    next: hayMas ? (visibles.at(-1)?.createdAt ?? null) : null,
  };
}
