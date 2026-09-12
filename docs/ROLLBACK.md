# Volver atrás

Qué hacer cuando un despliegue deja el sitio peor que antes. Está escrito para
leerse con prisa, así que va del caso más probable al menos probable, y cada
paso dice qué se pierde.

Lo primero, y no es un trámite: **mirar si de verdad hay que volver atrás.**
El despliegue falla en tres sitios distintos y solo uno deja el sitio tocado.

| Dónde falló | Qué está sirviendo el sitio | Hay que volver atrás |
|---|---|---|
| `verificar` (tipos, RTL, planos, build) | lo de antes, intacto — el servidor ni se enteró | no |
| `Desplegar`, antes de `npm run build` | lo de antes: el proceso viejo sigue vivo | no, se arregla y se vuelve a subir |
| `Desplegar`, después de reiniciar el servicio | lo NUEVO, y está mal | sí |
| las cuatro comprobaciones de después (`/`, el PNG, `og:image`, `lang="ar"`) | lo nuevo, y algo no responde | sí |

## 1. Volver al commit anterior

Es lo normal y no toca la base de datos.

```bash
ssh <servidor>                       # el mismo usuario del despliegue
cd /www/wwwroot/citas
git log --oneline -5                 # elegir el último que SÍ estaba bien
git checkout <commit-bueno>
sudo bash deploy/install.sh          # recompila y reinicia con ese código
```

`install.sh` es idempotente: no toca el `.env` que ya existe, ni la llave de
cifrado, ni la contraseña de la base. Lo que hace es recompilar y reiniciar.

Comprobar, en este orden —el primero que falle dice dónde está el problema—:

```bash
systemctl status citas citas-whatsapp --no-pager
curl -s localhost:3001/healthz       # ¿vive el proceso?
curl -s localhost:3001/readyz        # ¿puede leer la base?
curl -s -o /dev/null -w '%{http_code}\n' https://citas.posxml.com/i/ejemplo-ar
```

Después, **en el repositorio**, dejar la rama donde está el servidor. Si no, el
siguiente despliegue vuelve a subir lo que se acaba de quitar:

```bash
git revert <commit-malo>             # revert, no reset: la rama es pública
git push
```

## 2. Si el problema es una migración

Las migraciones de este proyecto son ADITIVAS: crean tablas, columnas e
índices, y no borran ni estrechan nada. Eso tiene una consecuencia práctica muy
buena: **el código viejo funciona contra el esquema nuevo**, porque lo que no
conoce, no lo consulta. Así que el paso 1 basta casi siempre y no hay que tocar
la base.

`prisma migrate deploy` no sabe deshacer. Si de verdad hubiera que deshacer una
migración, se escribe la contraria a mano y se aplica como una migración nueva;
no se edita ni se borra la que ya se aplicó, porque `_prisma_migrations` lleva
la cuenta y una base a la que le falte una fila que sus tablas sí tienen es una
base que ninguna herramienta sabe arreglar.

## 3. Si hay que restaurar datos

Esto es lo último y lo que sí pierde cosas: **todo lo que entró desde la copia**
—confirmaciones de invitados, pagos, mensajes—. Solo se hace si la base quedó
corrupta o si algo borró datos.

```bash
/usr/local/bin/backup-citas.sh              # una copia de AHORA, antes de tocar nada
/www/wwwroot/citas/deploy/probar-restauracion.sh   # restaura en una base aparte y compara
```

Restaurar de verdad encima de la de producción es el último recurso, con el
servicio parado (`systemctl stop citas`) y con la copia de «ahora» a mano.

## 4. Lo que NO se hace

- **No `git reset --force` sobre la rama publicada.** Es la rama de despliegue y
  la mira el flujo de GitHub; reescribirla deja al servidor y al repositorio
  contando historias distintas. `git revert`.
- **No editar el código en el servidor** para apagar el fuego. Lo que no está en
  git desaparece en el siguiente despliegue, y nadie se acuerda de que estaba.
- **No borrar la llave** (`/etc/citas/secret.key`). Con ella se descifran la
  contraseña del SMTP, la del IMAP, la clave de Whish y las credenciales de
  WhatsApp. Sin ella no se recuperan: hay que volver a escribirlas todas y a
  escanear otra vez cada número.
- **No desactivar los temporizadores** para «que deje de dar errores». El de
  conciliar es lo que se entera de que una boda pagó; el del SINPE, de que entró
  un pago. Apagados, el sitio parece tranquilo y el dinero deja de entrar.

## 5. Lo que hay que saber antes de que pase

- El sitio corre en `127.0.0.1:3001` y nginx (en aaPanel) lo publica. Si el
  proceso está bien y el sitio no responde, el problema es el proxy, no esto.
- Cinco unidades: `citas.service`, `citas-whatsapp.service`,
  `citas-conciliar.timer`, `citas-recordatorios.timer`, `citas-sinpe.timer`.
- El diario de la última hora, que es donde está escrito lo que pasó:
  `journalctl -u citas --since '1 hour ago' --no-pager`.
