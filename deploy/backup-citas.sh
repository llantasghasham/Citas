#!/bin/bash
# Respaldo diario de la base de datos de Citas.
#
# aaPanel respalda MariaDB solo; PostgreSQL no está en su panel, así que esta es
# la pieza que hay que poner a mano. Instalar así:
#
#   cp /www/wwwroot/citas/deploy/backup-citas.sh /usr/local/bin/
#   chmod 700 /usr/local/bin/backup-citas.sh
#   crontab -e   →   30 3 * * *  /usr/local/bin/backup-citas.sh
#
# Y comprobar de vez en cuando que un respaldo restaura. Un respaldo que nadie
# ha restaurado nunca no es un respaldo.
set -euo pipefail

DESTINO=/www/backup/citas
DIAS=14

mkdir -p "$DESTINO"
chmod 700 "$DESTINO"

ARCHIVO="$DESTINO/citas-$(date +%F-%H%M).sql.gz"
sudo -u postgres pg_dump --no-owner --no-privileges citas | gzip -9 > "$ARCHIVO"
chmod 600 "$ARCHIVO"

# Un volcado vacío es peor que ninguno: avisa en vez de pisar los buenos.
if [ ! -s "$ARCHIVO" ]; then
  echo "backup-citas: el volcado salió vacío" >&2
  exit 1
fi

find "$DESTINO" -name 'citas-*.sql.gz' -mtime "+$DIAS" -delete
