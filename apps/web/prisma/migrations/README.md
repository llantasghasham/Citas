# Antes de leer estas migraciones

Esta carpeta es un **historial**, no el esquema. Cada archivo dice lo que se
cambió aquel día, no lo que hay hoy. Una migración de septiembre puede crear un
índice que una de octubre tira y sustituye, y las dos siguen aquí porque así es
como funciona un historial: no se borra ni se edita nada.

Y no se edita **nunca**. Prisma guarda la huella de cada `migration.sql` en la
tabla `_prisma_migrations`; cambiar un archivo ya aplicado hace que el despliegue
se niegue a seguir, en todas las bases donde ya se aplicó. Si algo está mal, se
arregla con una migración NUEVA que lo sustituya. Este archivo sí se puede
editar: Prisma solo mira los `migration.sql`.

## Cómo se mira el esquema de verdad

```bash
npm run db:check --workspace @citas/web
```

Crea una base desde cero, aplica **todas** las migraciones en orden, comprueba
diecisiete cosas que la base tiene que impedir —claves foráneas compuestas,
índices únicos parciales, restricciones diferidas— e **imprime** la definición
final de los tres índices que más se leen mal. Es lo que corre en cada empujón
(`.github/workflows/pruebas.yml`), así que la respuesta está también en el
registro de la última ejecución.

## Lo que ya ha confundido a dos revisiones

**El índice que evita mandarle dos veces el mismo mensaje a un invitado.**

`20260916100000_queue_no_duplicates` lo crea sobre `(eventId, guestId, kind)`,
cuando todavía no existían los actos. Leído solo, parece que un invitado no
podría recibir la invitación de la henna **y** la de la recepción.

`20260920100000_consentimiento_campanas_puerta` lo **tira y pone dos en su
lugar**: uno sobre `(eventId, guestId, kind, actId)` para los mensajes de un
acto, y otro sobre `(eventId, guestId, kind)` para los de «la celebración
entera» —`actId` nulo—, porque en PostgreSQL dos nulos no chocan en un índice
único y con uno solo se podrían encolar cien.

Lo que se puede y lo que no está en `docs/DECISIONES-TOMADAS.md` §9, con una
tabla, y probado escribiendo directo en la tabla —así que quien acepta o rechaza
es el índice, no el código— en `tests/cola.test.ts`, «el ACTO entra en la clave».
