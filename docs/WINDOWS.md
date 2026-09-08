# Levantarlo en Windows

## Antes de nada: XAMPP no sirve para esto

XAMPP es **Apache + MySQL + PHP**. Este proyecto es **Node.js + PostgreSQL**.

- La carpeta puede estar donde quieras, `C:\xampp\src\citas` incluido. Es solo
  una carpeta.
- Pero **no se arranca desde el panel de XAMPP**, y **no usa su MySQL**. Apache
  no puede servir una aplicación Next.js.
- Se arranca con `npm run dev` en una terminal, y la base de datos es un
  PostgreSQL aparte.

Si ya tienes XAMPP instalado, no molesta: déjalo apagado.

## Lo que hay que instalar

| Pieza | Dónde | Para qué |
| --- | --- | --- |
| **Node.js 20 o superior** | nodejs.org (instalador LTS) | ejecutar la aplicación |
| **PostgreSQL 16** | postgresql.org/download/windows | la base de datos |
| **Google Chrome** | probablemente ya lo tienes | generar el PNG de la invitación |

Durante la instalación de PostgreSQL apunta la **contraseña del usuario
`postgres`**: hace falta enseguida.

## Traer el código

```cmd
cd C:\xampp\src
git clone https://github.com/llantasghasham/Citas.git citas
cd citas
git checkout claude/invitation-render-engine-9sv1tp
npm install
```

## Crear la base de datos

En el menú de inicio, abre **SQL Shell (psql)**, entra con la contraseña que
pusiste, y escribe:

```sql
CREATE DATABASE citas;
```

## Configurar

Copia `apps\web\.env.example` a `apps\web\.env` y déjalo así (cambiando la
contraseña por la tuya):

```ini
DATABASE_URL="postgresql://postgres:TU_CONTRASEÑA@localhost:5432/citas?schema=public"
DATA_SOURCE="database"
CHROMIUM_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
PAYMENTS_PROVIDER="mock"
```

> **Esto importa en Windows.** En las guías de Linux verás cosas como
> `DATA_SOURCE=database npm run dev`. **Eso no funciona en la consola de
> Windows.** Por eso todo va en el archivo `.env`: así basta con `npm run dev`.
>
> `CHROMIUM_PATH` puedes omitirlo si Chrome está en la ruta habitual: el
> programa la busca solo.

## Arrancar

```cmd
npm run db:deploy
npm run db:seed
npm run dev
```

| Dirección | Qué es |
| --- | --- |
| `http://localhost:3000/i/ejemplo-ar` | La invitación en árabe |
| `http://localhost:3000/crear` | Crear una invitación |
| `http://app.localhost:3000/entrar` | El panel (`admin@citas.local`) |

**El código de acceso no llega por correo en local**: sale escrito en la misma
terminal donde corre `npm run dev`. Búscalo ahí.

`npm run dev` siempre usa el **puerto 3000**. Poner `PORT` en el `.env` no
cambia nada: Next lo lee antes que el archivo. Para otro puerto:
`npx next dev -p 3001` dentro de `apps\web`.

## Si `app.localhost` no abre

Chrome y Edge resuelven `*.localhost` solos. Si tu equipo no lo hace, añade esta
línea a `C:\Windows\System32\drivers\etc\hosts` (editando el archivo como
administrador):

```
127.0.0.1  app.localhost
```

## Problemas frecuentes

| Síntoma | Qué pasa |
| --- | --- |
| `'DATA_SOURCE' no se reconoce...` | Estás copiando un comando de Linux. Pon la variable en `apps\web\.env`. |
| `No Chromium could be started` | Chrome no está donde se espera. Pon `CHROMIUM_PATH` con la ruta real. |
| `Can't reach database server` | PostgreSQL no está arrancado, o la contraseña del `.env` no es la correcta. |
| El panel no abre en `app.localhost` | Mira el apartado de arriba sobre el archivo `hosts`. |
| Nada carga y XAMPP está encendido | Si Apache ocupa el puerto 3000 —raro— apágalo. No hace falta para nada. |
