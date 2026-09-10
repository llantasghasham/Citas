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
SERVICE_WA="/etc/systemd/system/citas-whatsapp.service"
SERVICE_REC="/etc/systemd/system/citas-conciliar.service"
SERVICE_REM="/etc/systemd/system/citas-recordatorios.service"
TIMER_REM="/etc/systemd/system/citas-recordatorios.timer"
TIMER_REC="/etc/systemd/system/citas-conciliar.timer"
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
# Si ya hay un servicio instalado, se conserva SU puerto. Buscar uno libre en
# cada reinstalación sería mudarse siempre: el puerto viejo está ocupado por esta
# misma aplicación, se elegiría el siguiente, y nginx —que apunta al de antes—
# empezaría a devolver 502. Pasó exactamente así el 2026-09-09.
PORT="$(sed -n 's/.*--port \([0-9]\+\).*/\1/p' "$SERVICE" 2>/dev/null | head -1)"

if [ -n "$PORT" ]; then
  ok "puerto conservado del servicio ya instalado: $PORT"
else
  for candidato in 3000 3001 3002 3003 3010; do
    if ! puerto_ocupado "$candidato"; then PORT="$candidato"; break; fi
  done
  [ -n "$PORT" ] || alto "no hay ningún puerto libre entre 3000 y 3010"
  ok "puerto libre: $PORT"
fi

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
# En AlmaLinux `/usr/bin/chromium-browser` es un guion envoltorio, no el binario.
# Puppeteer lo lanza igual, pero el proceso muere antes de abrir el puerto de
# depuración con "chrome_crashpad_handler: --database is required", y el PNG
# devuelve 500. Hay que apuntar al ejecutable de verdad.
case "$(readlink -f "${CHROME:-/dev/null}")" in
  *.sh)
    for real in /usr/lib64/chromium-browser/chromium-browser \
                /usr/lib/chromium-browser/chromium-browser \
                /usr/lib64/chromium/chromium; do
      if [ -x "$real" ]; then CHROME="$real"; break; fi
    done
    ;;
esac

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
  npm ci --ignore-scripts --include-workspace-root --workspace @citas/web --workspace @citas/core --workspace @citas/whatsapp &&
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
# ProtectHome esconde /home/$APP_USER, y sin un HOME donde escribir su base de
# datos de fallos Chromium no llega a arrancar: el PNG daría 500. PrivateTmp
# hace que este /tmp sea exclusivo del servicio.
Environment=HOME=/tmp
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

# ------------------------------------------------------- 6b. WhatsApp por QR

paso "Servicio de WhatsApp"

# El token lo comparten DOS procesos que arrancan por separado, así que vive en
# el mismo .env que ya lee la web y systemd se lo pasa al otro por
# EnvironmentFile. Se genera una vez y no se vuelve a tocar: cambiarlo dejaría a
# la web hablándole al servicio con una llave que ya no vale.
if ! grep -q '^WHATSAPP_GATEWAY_TOKEN=' "$ENV_FILE" 2>/dev/null; then
  TOKEN="$(openssl rand -base64 33 | tr -d '=+/' | cut -c1-40)"
  printf '\n# Secreto compartido entre la web y el servicio de WhatsApp.\n' >> "$ENV_FILE"
  printf 'WHATSAPP_GATEWAY_TOKEN="%s"\n' "$TOKEN" >> "$ENV_FILE"
  printf 'WHATSAPP_GATEWAY_PORT="4100"\n' >> "$ENV_FILE"
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok "token del servicio de WhatsApp generado (no se muestra)"
else
  ok "el token de WhatsApp ya estaba puesto"
fi

cat > "$SERVICE_WA" <<UNIT
[Unit]
Description=Citas — servicio de WhatsApp
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$DIR/apps/whatsapp
# El MISMO archivo que lee la web: un solo sitio para el token, la base de datos
# y la llave de cifrado. systemd le quita las comillas a los valores.
EnvironmentFile=$DIR/apps/web/.env
ExecStart=$NODE_BIN $DIR/node_modules/tsx/dist/cli.mjs $DIR/apps/whatsapp/src/index.ts
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=HOME=/tmp
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now citas-whatsapp >/dev/null 2>&1
systemctl restart citas-whatsapp
sleep 3
# No detiene el despliegue si falla: sin este servicio se sigue enviando a mano
# con wa.me, que es como funcionaba antes de que existiera.
if systemctl is-active --quiet citas-whatsapp; then
  ok "el servicio de WhatsApp responde"
else
  aviso "el servicio de WhatsApp no arrancó — mira: journalctl -u citas-whatsapp -n 40"
  aviso "la web sigue funcionando; se envía a mano con wa.me hasta que arranque"
fi

paso "Repaso de cobros"

# El aviso de pago de Whish no va firmado, así que en este proyecto solo vale
# como aviso: quien decide es preguntarle al proveedor. Y un aviso se pierde —el
# servidor reiniciando, la red caída, Whish rindiéndose tras tres reintentos—.
# Sin este repaso, un cobro cuyo aviso se perdiera se quedaría «pendiente» hasta
# que alguien abriera una pantalla. Alguien pagó su boda; que se entere el
# sistema no puede depender de que alguien mire.
cat > "$SERVICE_REC" <<UNIT
[Unit]
Description=Citas — repaso de cobros pendientes
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=oneshot
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$DIR/apps/web
EnvironmentFile=$DIR/apps/web/.env
ExecStart=$NODE_BIN $DIR/node_modules/tsx/dist/cli.mjs $DIR/apps/web/scripts/reconcile-payments.ts
Environment=NODE_ENV=production
Environment=HOME=/tmp
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
UNIT

cat > "$TIMER_REC" <<UNIT
[Unit]
Description=Citas — repaso de cobros pendientes, cada cinco minutos

[Timer]
OnBootSec=5min
OnUnitActiveSec=5min
# Si la máquina estuvo apagada, se ejecuta al volver en vez de saltarse el turno.
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now citas-conciliar.timer >/dev/null 2>&1
# Tampoco detiene el despliegue: sin el repaso se sigue cobrando, solo que un
# aviso perdido lo arregla una persona pulsando el botón de la factura.
if systemctl is-active --quiet citas-conciliar.timer; then
  ok "el repaso de cobros corre cada cinco minutos"
else
  aviso "el repaso de cobros no arrancó — mira: journalctl -u citas-conciliar -n 40"
fi

paso "Recordatorios"

# Encola —no manda— los recordatorios a quien no ha contestado, los días antes
# que cada evento tenga puestos. Quien manda sigue siendo el servicio de
# WhatsApp, de uno en uno y con su freno: un trabajo automático que mandara
# directamente es un trabajo que vacía el cupo de un número mientras nadie mira.
cat > "$SERVICE_REM" <<UNIT
[Unit]
Description=Citas — recordatorios a quien no ha contestado
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=oneshot
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$DIR/apps/web
EnvironmentFile=$DIR/apps/web/.env
ExecStart=$NODE_BIN $DIR/node_modules/tsx/dist/cli.mjs $DIR/apps/web/scripts/send-reminders.ts
Environment=NODE_ENV=production
Environment=HOME=/tmp
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
UNIT

cat > "$TIMER_REM" <<UNIT
[Unit]
Description=Citas — recordatorios, cada cuarto de hora

[Timer]
OnBootSec=10min
OnUnitActiveSec=15min
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now citas-recordatorios.timer >/dev/null 2>&1
if systemctl is-active --quiet citas-recordatorios.timer; then
  ok "los recordatorios se revisan cada cuarto de hora"
else
  aviso "los recordatorios no arrancaron — mira: journalctl -u citas-recordatorios -n 40"
fi

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

 LO QUE FALTA, y no se puede hacer desde aquí:

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

 3. WHATSAPP POR QR (opcional, y léalo antes)
    Ya está instalado y corriendo: systemctl status citas-whatsapp
    Se conecta un número en /panel/configuracion?s=whatsapp
    ANTES de escanear, lea docs/WHATSAPP.md: automatizar un número personal
    va contra los términos de WhatsApp y el número que cierran es el suyo.

 4. RESPALDOS (aaPanel no respalda PostgreSQL)
    cp $DIR/deploy/backup-citas.sh /usr/local/bin/
    chmod 700 /usr/local/bin/backup-citas.sh
    crontab -e   →   30 3 * * *  /usr/local/bin/backup-citas.sh

 Para volver a desplegar tras un cambio: ejecuta este mismo script otra vez.
────────────────────────────────────────────────────────────
FIN
