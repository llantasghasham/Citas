#!/bin/bash
# Respaldo diario de Citas: la base del arrendador Y la de cada oficina.
#
# Desde que cada oficina tiene su propia base de datos, «respaldar Citas» dejó
# de ser un volcado. Un guion que vuelque solo `citas` hoy se lleva el registro
# de oficinas, los planes y los cobros — y NINGUNA boda, NINGÚN invitado y
# NINGUNA mesa. Saldría verde todos los días y el día que hiciera falta no
# habría nada que restaurar. Por eso esto enumera las bases, no las escribe.
#
# Instalar:
#   cp /www/wwwroot/citas/deploy/backup-citas.sh /usr/local/bin/
#   chmod 700 /usr/local/bin/backup-citas.sh
#   crontab -e   →   30 3 * * *  /usr/local/bin/backup-citas.sh
#
# Restaurar UNA oficina (sin tocar a las demás, que es media razón de esto):
#   createdb citas_of_agenciax
#   pg_restore --no-owner --no-privileges -d citas_of_agenciax \
#     /www/backup/citas/2026-09-11-0330/citas_of_agenciax.dump
#
# LA LLAVE NO VA AQUÍ. Las contraseñas de servicio y la sesión de WhatsApp están
# cifradas con la llave de `CITAS_SECRET_KEY_FILE`, que vive FUERA de la base: un
# volcado sin ella no revela ningún secreto —que es justo para lo que se cifró— y
# tampoco sirve para levantarlos. Guárdela aparte, en otro sitio, y no en la
# misma carpeta que esto: copiarla al lado de los volcados deshace el cifrado.
#
# Y esto sigue estando en el MISMO servidor. Un respaldo que se pierde con la
# máquina que respalda no es un respaldo: hay que sacarlo fuera. Ver
# `docs/DESPLIEGUE-VPS.md`.
set -euo pipefail

DESTINO=${CITAS_BACKUP_DIR:-/www/backup/citas}
DIAS=${CITAS_BACKUP_DIAS:-14}
CONTROL=${CITAS_DB:-citas}
# `sudo -u postgres` es lo normal en un VPS; en Docker o con PostgreSQL
# gestionado se conecta de otra manera, y por eso se puede cambiar.
COMO=${CITAS_PG_SUDO-sudo -u postgres}
PSQL="$COMO psql"
DUMP="$COMO pg_dump --no-owner --no-privileges -Fc"

CARPETA="$DESTINO/$(date +%F-%H%M)"
mkdir -p "$CARPETA"
chmod 700 "$DESTINO" "$CARPETA"

# Las oficinas se PREGUNTAN. La plantilla no: no tiene datos y se rehace con
# `npm run db:fleet -- migrar`.
BASES=$($PSQL -At -d postgres -c \
  "SELECT datname FROM pg_database
    WHERE datname = '$CONTROL' OR (datname LIKE 'citas\_of\_%' AND datname <> 'citas_of_plantilla')
    ORDER BY datname <> '$CONTROL', datname")

if [ -z "$BASES" ]; then
  echo "backup-citas: no se encontró ni la base de control ($CONTROL)" >&2
  exit 1
fi

FALLOS=0
TOTAL=0
for BASE in $BASES; do
  ARCHIVO="$CARPETA/$BASE.dump"
  if ! $DUMP "$BASE" > "$ARCHIVO" 2>"$CARPETA/$BASE.error"; then
    echo "backup-citas: falló el volcado de $BASE" >&2
    cat "$CARPETA/$BASE.error" >&2
    FALLOS=$((FALLOS + 1))
    continue
  fi
  rm -f "$CARPETA/$BASE.error"
  chmod 600 "$ARCHIVO"

  # Que exista y pese no es que sirva. `pg_restore -l` lee el índice del volcado:
  # si está truncado o corrupto, falla aquí y no el día que haga falta.
  if [ ! -s "$ARCHIVO" ] || ! pg_restore -l "$ARCHIVO" > /dev/null 2>&1; then
    echo "backup-citas: el volcado de $BASE no se puede leer" >&2
    FALLOS=$((FALLOS + 1))
    continue
  fi
  TOTAL=$((TOTAL + 1))
  echo "$BASE $(stat -c %s "$ARCHIVO")" >> "$CARPETA/MANIFIESTO"
done

# Cuántas había que respaldar, para que falte una y se note. Sin esto, una
# oficina que desapareciera del volcado se vería igual que un día normal.
ESPERADAS=$(echo "$BASES" | wc -l)
echo "esperadas $ESPERADAS · respaldadas $TOTAL · fallidas $FALLOS" >> "$CARPETA/MANIFIESTO"
chmod 600 "$CARPETA/MANIFIESTO"

# Se borra lo viejo SOLO si lo de hoy salió entero: con un respaldo fallido, lo
# último que hay que hacer es tirar el último que sí valía.
if [ "$FALLOS" -gt 0 ]; then
  echo "backup-citas: $FALLOS de $ESPERADAS bases sin respaldar. No se borra nada viejo." >&2
  exit 1
fi

find "$DESTINO" -mindepth 1 -maxdepth 1 -type d -mtime "+$DIAS" -exec rm -rf {} +
echo "backup-citas: $TOTAL bases en $CARPETA"
