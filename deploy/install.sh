#!/bin/bash
# Instalación de Citas en un VPS con aaPanel (AlmaLinux / RHEL).
#
#   curl -fsSL https://raw.githubusercontent.com/llantasghasham/Citas/claude/invitation-render-engine-9sv1tp/deploy/install.sh | bash
#
# o, si ya clonaste:  bash /www/wwwroot/citas/deploy/install.sh
#
# Se puede volver a ejecutar cuantas veces haga falta: actualiza el código y
# recompila sin tocar la configuración ni los datos que ya existan.
#
# LO QUE NO HACE, a propósito:
#   - No toca sshd. El acceso por contraseña se queda como está.
#   - No toca ningún vhost de nginx. Eso se hace desde aaPanel.
#   - No sobrescribe un .env que ya exista.
#   - No borra ni modifica otros proyectos de /www/wwwroot.
set -euo pipefail

REPO_URL="https://github.com/llantasghasham/Citas.git"
BRANCH="claude/invitation-render-engine-9sv1tp"
DIR="/www/wwwroot/citas"
KEY_FILE="/etc/citas/secret.key"
DB_NAME="citas"
DB_USER="citas_app"
SERVICE="/etc/systemd/system/citas.service"
APP_USER="www"

paso() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
aviso() { printf '    \033[33m! %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✓ %s\033[0m\n' "$*"; }
alto() { printf '\n\033[31mDETENIDO: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || alto "hay que ejecutarlo como root"
id "$APP_USER" >/dev/null 2>&1 || alto "no existe el usuario $APP_USER (¿está aaPanel instalado?)"
command -v dnf >/dev/null || alto "esto está escrito para AlmaLinux/RHEL (no encuentro dnf)"

# ---------------------------------------------------------------- 1. entorno

paso "Comprobando el entorno"

NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || alto "no encuentro node en el PATH"
NODE_MAJOR="$("$NODE_BIN" -v | sed 's/^v\([0-9]*\).*/\1/')"
[ "$NODE_MAJOR" -ge 20 ] || alto "hace falta Node 20 o superior (tienes $("$NODE_BIN" -v))"
ok "node $("$NODE_BIN" -v) en $NODE_BIN"

# El puerto se elige probando a conectarse de verdad, no leyendo la salida de
# `ss`: si esa herramienta falta o falla, la comprobación pasaría en silencio y
# elegiríamos un puerto ya ocupado por otro proyecto de este servidor.
puerto_ocupado() {
  timeout 1 bash -c "cat < /dev/null > /dev/tcp/127.0.0.1/$1" 2>/dev/null
}
PORT=""
for candidato in 3000 3001 3002 3003 3010; do
  if ! puerto_ocupado "$candidato"; then PORT="$candidato"; break; fi
done
[ -n "$PORT" ] || alto "no hay ningún puerto libre entre 3000 y 3010"
ok "puerto libre: $PORT"

LIBRE_KB="$(df -Pk /www | awk 'NR==2 {print $4}')"
[ "$LIBRE_KB" -gt 3000000 ] || alto "hacen falta al menos 3 GB libres en /www"
ok "espacio en /www: $(df -Ph /www | awk 'NR==2 {print $4}') libres"

# ---------------------------------------------------------------- 2. paquetes

paso "PostgreSQL y Chromium"

if ! rpm -q postgresql-server >/dev/null 2>&1; then
  dnf install -y postgresql-server postgresql-contrib >/dev/null
  ok "PostgreSQL instalado"
else
  ok "PostgreSQL ya estaba instalado"
fi

if [ ! -f /var/lib/pgsql/data/PG_VERSION ]; then
  postgresql-setup --initdb >/dev/null
  ok "base de datos inicializada"
fi
systemctl enable --now postgresql >/dev/null 2>&1
systemctl is-active --quiet postgresql || alto "PostgreSQL no arrancó — mira: systemctl status postgresql"
ok "PostgreSQL activo ($(sudo -u postgres psql -tAc 'SHOW server_version' | tr -d ' '))"

CHROME="$(command -v chromium || command -v chromium-browser || command -v google-chrome-stable || true)"
if [ -z "$CHROME" ]; then
  dnf install -y epel-release >/dev/null 2>&1 || true
  dnf install -y chromium >/dev/null 2>&1 || \
    dnf install -y https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm >/dev/null 2>&1 || true
  CHROME="$(command -v chromium || command -v chromium-browser || command -v google-chrome-stable || true)"
fi
# Sin navegador la aplicación arranca igual, pero no genera la imagen de la
# invitación ni la vista previa de WhatsApp. Se avisa, no se detiene.
[ -n "$CHROME" ] && ok "navegador: $CHROME" || aviso "sin Chromium: el PNG de la invitación NO funcionará"

# ---------------------------------------------------------------- 3. código

paso "El código"

if [ -d "$DIR/.git" ]; then
  sudo -u "$APP_USER" git -C "$DIR" fetch --quiet origin "$BRANCH"
  sudo -u "$APP_USER" git -C "$DIR" checkout --quiet "$BRANCH"
  sudo -u "$APP_USER" git -C "$DIR" reset --hard --quiet "origin/$BRANCH"
  ok "código actualizado"
else
  [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ] && alto "$DIR existe y no está vacío; muévelo o bórralo antes"
  git clone --quiet -b "$BRANCH" "$REPO_URL" "$DIR"
  ok "repositorio clonado en $DIR"
fi
chown -R "$APP_USER:$APP_USER" "$DIR"

# ---------------------------------------------------------------- 4. secretos

paso "Base de datos y secretos"

if [ ! -f "$KEY_FILE" ]; then
  mkdir -p "$(dirname "$KEY_FILE")"
  openssl rand -base64 32 > "$KEY_FILE"
  chown "$APP_USER:$APP_USER" "$KEY_FILE"
  chmod 400 "$KEY_FILE"
  ok "llave de cifrado creada en $KEY_FILE"
else
  ok "la llave de cifrado ya existía (no se toca)"
fi

ENV_FILE="$DIR/apps/web/.env"
if [ -f "$ENV_FILE" ]; then
  # Volver a generar la contraseña dejaría la aplicación sin poder conectarse.
  ok "ya existe apps/web/.env — se respeta tal cual"
else
  DB_PASS="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 \
    && sudo -u postgres psql -qc "ALTER USER $DB_USER WITH PASSWORD '$DB_PASS';" \
    || sudo -u postgres psql -qc "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
    || sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
  sudo -u postgres psql -qc "ALTER DATABASE $DB_NAME OWNER TO $DB_USER;"

  cat > "$ENV_FILE" <<ENV
DATABASE_URL="postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME?schema=public"
DATA_SOURCE="database"
CHROMIUM_PATH="$CHROME"
NEXT_PUBLIC_SITE_URL="https://citas.posxml.com"
PAYMENTS_PROVIDER="mock"
SUPERADMIN_EMAIL="cambiame@ejemplo.com"
CITAS_SECRET_KEY_FILE="$KEY_FILE"

# Correo saliente. Sin esto NO se puede entrar al panel.
# MAILER="smtp"
# SMTP_HOST=""
# SMTP_PORT="587"
# SMTP_USER=""
# MAIL_FROM=""
# SMTP_PASSWORD_ENC=""
ENV
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok "apps/web/.env creado (600, dueño $APP_USER) — la contraseña no se muestra"
fi

# ---------------------------------------------------------------- 5. compilar

paso "Instalando dependencias y compilando (tarda unos minutos)"

sudo -u "$APP_USER" bash -lc "
  cd '$DIR' &&
  npm ci --ignore-scripts --include-workspace-root --workspace @citas/web --workspace @citas/core &&
  npm run db:generate --workspace @citas/web &&
  npm run db:deploy   --workspace @citas/web &&
  npm run db:seed     --workspace @citas/web &&
  npm run build       --workspace @citas/web
" || alto "falló la compilación — mira el error de arriba"
ok "compilado"

# ---------------------------------------------------------------- 6. servicio

paso "Servicio"

cat > "$SERVICE" <<UNIT
[Unit]
Description=Citas — invitaciones digitales
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$DIR/apps/web
ExecStart=$NODE_BIN $DIR/node_modules/next/dist/bin/next start --port $PORT
Restart=always
RestartSec=5
Environment=HOSTNAME=127.0.0.1
Environment=NODE_ENV=production
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now citas >/dev/null 2>&1
systemctl restart citas
sleep 4
systemctl is-active --quiet citas || alto "el servicio no arrancó — mira: journalctl -u citas -n 40"

CODIGO="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/i/ejemplo-ar" || true)"
[ "$CODIGO" = "200" ] || alto "el servicio responde $CODIGO en el puerto $PORT — mira: journalctl -u citas -n 40"
ok "responde en http://127.0.0.1:$PORT"

# SELinux impide que nginx hable con un puerto local. Es la causa del 502
# clásico en AlmaLinux, y solo se toca este interruptor.
if command -v getenforce >/dev/null && [ "$(getenforce)" = "Enforcing" ]; then
  setsebool -P httpd_can_network_connect 1
  ok "SELinux: permitido que nginx conecte al puerto local"
fi

# ---------------------------------------------------------------- 7. resumen

cat <<FIN

────────────────────────────────────────────────────────────
 Listo. La aplicación corre en 127.0.0.1:$PORT

 TE FALTAN TRES COSAS, y ninguna se puede hacer desde aquí:

 1. nginx, EN aaPANEL (no edites los vhosts a mano)
    Sitios → citas.posxml.com → Proxy inverso
      destino: http://127.0.0.1:$PORT
    Después: SSL → Let's Encrypt

 2. EL CORREO, o no podrás entrar al panel
    Edita $ENV_FILE, pon SUPERADMIN_EMAIL y los datos SMTP.
    La contraseña, cifrada:
      printf %s 'LA-CONTRASEÑA' | sudo -u $APP_USER env \\
        CITAS_SECRET_KEY_FILE=$KEY_FILE \\
        npm run secret:encrypt --workspace @citas/web --silent --prefix $DIR
    Pega el resultado en SMTP_PASSWORD_ENC, pon MAILER="smtp",
    y luego:  systemctl restart citas && npm run db:seed --workspace @citas/web --prefix $DIR

 3. RESPALDOS (aaPanel no respalda PostgreSQL)
    cp $DIR/deploy/backup-citas.sh /usr/local/bin/
    chmod 700 /usr/local/bin/backup-citas.sh
    crontab -e   →   30 3 * * *  /usr/local/bin/backup-citas.sh

 Para volver a desplegar tras un cambio: ejecuta este mismo script otra vez.
────────────────────────────────────────────────────────────
FIN
