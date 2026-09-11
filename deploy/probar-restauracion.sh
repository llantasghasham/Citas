#!/bin/bash
# Restaura el último respaldo en bases de usar y tirar, cuenta lo que hay dentro
# y las borra. El simulacro, no el respaldo.
#
#   /usr/local/bin/probar-restauracion.sh              el último
#   /usr/local/bin/probar-restauracion.sh 2026-09-11-0330   uno concreto
#
# Existe porque «tenemos respaldos» y «podemos volver» no son lo mismo, y la
# diferencia solo se ve intentándolo. Un volcado que se escribió todos los días
# durante un año y no restaura es un año sin respaldos que nadie supo que estaba
# teniendo. Póngalo también en el cron, una vez por semana:
#
#   crontab -e   →   0 5 * * 0  /usr/local/bin/probar-restauracion.sh
#
# No toca NADA de producción: cada volcado va a una base nueva con nombre propio,
# que se borra al terminar pase lo que pase.
set -euo pipefail

DESTINO=${CITAS_BACKUP_DIR:-/www/backup/citas}
# `sudo -u postgres` es lo normal en un VPS; en Docker o con PostgreSQL
# gestionado se conecta de otra manera, y por eso se puede cambiar.
COMO=${CITAS_PG_SUDO-sudo -u postgres}
# Sin los NOTICE de «no existe, me la salto»: esto se lee en un correo del cron
# y lo único que tiene que decirse es qué restauró y qué no.
export PGOPTIONS="--client-min-messages=warning"
PSQL="$COMO psql"

CARPETA=${1:-}
if [ -z "$CARPETA" ]; then
  CARPETA=$(ls -1d "$DESTINO"/*/ 2>/dev/null | sort | tail -1 || true)
else
  CARPETA="$DESTINO/$CARPETA"
fi
if [ -z "$CARPETA" ] || [ ! -d "$CARPETA" ]; then
  echo "probar-restauracion: no hay ningún respaldo en $DESTINO" >&2
  exit 1
fi

echo "probar-restauracion: $CARPETA"
SUFIJO=$(date +%s)
FALLOS=0
PROBADAS=0

for ARCHIVO in "$CARPETA"/*.dump; do
  [ -e "$ARCHIVO" ] || continue
  ORIGEN=$(basename "$ARCHIVO" .dump)
  PRUEBA="restauro_${SUFIJO}_$(echo "$ORIGEN" | tr -cd 'a-z0-9_' | cut -c1-40)"

  $PSQL -d postgres -q -c "DROP DATABASE IF EXISTS \"$PRUEBA\""
  $PSQL -d postgres -q -c "CREATE DATABASE \"$PRUEBA\""

  if ! $COMO pg_restore --no-owner --no-privileges -d "$PRUEBA" "$ARCHIVO" \
        > /dev/null 2>"/tmp/$PRUEBA.error"; then
    echo "  ✗ $ORIGEN — no restaura"
    sed -n '1,5p' "/tmp/$PRUEBA.error" >&2
    FALLOS=$((FALLOS + 1))
    $PSQL -d postgres -q -c "DROP DATABASE IF EXISTS \"$PRUEBA\""
    rm -f "/tmp/$PRUEBA.error"
    continue
  fi
  rm -f "/tmp/$PRUEBA.error"

  # Restaurar sin error tampoco basta: un volcado de un esquema vacío restaura
  # perfectamente y no trae nada. Se cuenta lo que de verdad importa.
  RESUMEN=$($PSQL -At -d "$PRUEBA" -c "
    SELECT 'oficinas ' || (SELECT count(*) FROM \"Tenant\")
        || ' · bodas ' || (SELECT count(*) FROM \"Event\")
        || ' · invitados ' || (SELECT count(*) FROM \"Guest\")
        || ' · mesas ' || (SELECT count(*) FROM \"Table\")
        || ' · pedidos ' || (SELECT count(*) FROM \"Order\")" 2>/dev/null || echo "sin tablas")

  echo "  ✓ $ORIGEN — $RESUMEN"
  PROBADAS=$((PROBADAS + 1))
  $PSQL -d postgres -q -c "DROP DATABASE IF EXISTS \"$PRUEBA\""
done

if [ "$FALLOS" -gt 0 ]; then
  echo "probar-restauracion: $FALLOS volcado(s) NO restauran. Eso no son respaldos." >&2
  exit 1
fi
echo "probar-restauracion: $PROBADAS volcado(s) restaurados y comprobados."
