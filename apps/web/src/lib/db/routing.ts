import { assertDatabaseName } from './naming';

/**
 * A qué servidor y con qué credenciales se llega a la base de una oficina.
 *
 * La flota vive en el mismo servidor que la base de control y con las mismas
 * credenciales: lo único que cambia es el nombre de la base. Se deriva de
 * `DATABASE_URL` en vez de guardar una URL por oficina, y es a propósito — una
 * URL de conexión lleva la contraseña dentro, y guardar trescientas contraseñas
 * en la base de datos para llegar a trescientas bases de datos es exactamente lo
 * que este proyecto no hace con ningún otro secreto.
 *
 * El día que una oficina tenga que vivir en otro servidor, `TENANT_DATABASE_URL`
 * lo resuelve sin tocar código: se pone en el entorno, con `{db}` donde va el
 * nombre. Sigue siendo el entorno, en 600 y fuera del repositorio, que es donde
 * el proyecto guarda lo que hace falta para arrancar.
 */

/** La base de control: el registro de oficinas, los planes y el cobro. */
export function controlUrl(): string {
  const raw = process.env['DATABASE_URL'];
  if (raw === undefined || raw.length === 0) {
    throw new Error('DATABASE_URL no está puesta. Póngala, o use DATA_SOURCE=json.');
  }
  return raw;
}

/** El nombre de la base de control, tal y como lo dice su propia URL. */
export function controlDatabaseName(): string {
  const path = new URL(controlUrl()).pathname.slice(1);
  return path.length > 0 ? path : 'postgres';
}

/**
 * La URL de una base cualquiera del mismo servidor.
 *
 * Se usa para la base de una oficina, y también para conectarse a `postgres` —
 * `CREATE DATABASE` no se puede ejecutar desde dentro de la base que se está
 * creando, hace falta estar conectado a otra.
 */
export function urlForDatabase(name: string): string {
  assertDatabaseName(name);

  const template = process.env['TENANT_DATABASE_URL'];
  if (template !== undefined && template.length > 0) {
    if (!template.includes('{db}')) {
      throw new Error('TENANT_DATABASE_URL tiene que llevar {db} donde va el nombre de la base.');
    }
    return template.replaceAll('{db}', name);
  }

  const url = new URL(controlUrl());
  url.pathname = `/${name}`;
  return url.toString();
}
