# WhatsApp por código QR

Sirve para no pegar doscientos enlaces a mano. **No sustituye a `wa.me`**: los
enlaces uno a uno siguen ahí, en la tabla de invitados, y son lo que funciona
siempre y sin riesgo.

## Léalo antes de conectar nada

Automatizar un número personal de WhatsApp para mandar en volumen **va contra
los términos de WhatsApp**. El número que pueden bloquear no es uno nuestro: es
el del cliente, el que sus invitados conocen y el que aparece en sus tarjetas.

Nada de lo que hay aquí lo hace permitido. Lo hace **sobrevivible**:

- Retardo **al azar** entre mensajes (por defecto de 8 a 25 segundos). Un
  intervalo exacto es una firma de máquina.
- **Tope diario** por número, que se ajusta en la pantalla. Se puede bajar; el
  código no deja subirlo por encima de 500.
- **Calentamiento**: un número recién conectado manda 20 el primer día, no 200.
- **De uno en uno** por número, nunca en paralelo.
- Se comprueba que el destino **existe en WhatsApp** antes de escribirle.
  Mandar a números muertos, uno detrás de otro, es otra señal de robot.

Consejo que no es código: empiece con veinte mensajes al día y suba a lo largo
de semanas, no de horas. Un número con años de conversaciones normales aguanta
mucho más que uno recién comprado.

## Cómo está montado

Un socket de WhatsApp es una conexión larga y una petición de Next termina. Por
eso es un **proceso aparte**:

```
apps/web         encola filas en WhatsappMessage
                 ↕ HTTP interno, con un token compartido
apps/whatsapp    sostiene los sockets, dibuja el QR y va soltando la cola
```

El servicio expone **dos** órdenes: abrir sesión y cerrarla. Deliberadamente NO
expone «manda este mensaje»: un extremo así permite vaciar el cupo de un número
en un bucle.

- Escucha en `127.0.0.1` y **no debe publicarse**. Aun así pide el token en cada
  petición y lo compara en tiempo constante.
- La sesión de WhatsApp se guarda **cifrada** (`WhatsappConnection.authEnc`),
  AES-256-GCM, con la llave en `CITAS_SECRET_KEY_FILE` — fuera de la base. Quien
  tenga esa sesión escribe desde el WhatsApp del cliente: es el secreto más
  peligroso del proyecto.
- Se guarda en la BASE y no en una carpeta porque desplegar copia código: una
  carpeta de sesiones se pierde en el primer despliegue y el cliente tendría que
  volver a escanear.

## Variables

Van en el entorno de los dos procesos, no en la tabla `Setting`: es un secreto
compartido por dos programas que arrancan por separado.

```
WHATSAPP_GATEWAY_TOKEN=   # al menos 24 caracteres; el mismo en los dos
WHATSAPP_GATEWAY_PORT=4100
DATABASE_URL=             # la misma que la web
CITAS_SECRET_KEY_FILE=    # la misma que la web
```

Eso es TODO lo que va en el entorno, y solo porque hace falta para arrancar:
el token lo comparten dos procesos que arrancan por separado, y lo demás es lo
que se necesita para poder leer la base de datos.

### El freno se ajusta en la pantalla

`/panel/configuracion?s=whatsapp`, solo el superadministrador:

| Campo | Rango | Por defecto |
|---|---|---|
| Segundos de espera, mínimo | 3 – 300 | 8 |
| Segundos de espera, máximo | 3 – 600 | 25 |
| Envíos el primer día de un número nuevo | 1 – 100 | 20 |
| Tope diario (por número, en su fila) | 1 – 500 | 200 |

Ahí va lo que hay que tocar cuando un número va apretado, y para eso nadie
debería entrar por SSH. **El servicio los relee cada minuto**, así que un cambio
surte efecto sin reiniciarlo — reiniciarlo para bajar unos segundos costaría que
cada oficina volviera a escanear su código.

**El freno se acorta, no se quita.** El mínimo son tres segundos y el código lo
recorta en los dos sitios: al guardar en el panel y al leer en el servicio. Lo
segundo es lo que manda, porque una fila escrita a mano en la base tampoco puede
quitarlo. Quien montó esto eligió expresamente la versión con freno sobre la
versión sin él; un retardo de cero la convertiría en la que descartó sin que
nadie lo decidiera.

Las tres variables siguen leyéndose del entorno como RESPALDO, para una
instalación que ya las tuviera puestas.

En producción NO hay que hacer nada de esto a mano: `deploy/install.sh` genera
el token, lo escribe en el mismo `apps/web/.env` que ya lee la web, e instala y
arranca el servicio `citas-whatsapp`. El token se genera UNA vez y no se vuelve
a tocar: cambiarlo dejaría a la web hablándole al servicio con una llave que ya
no vale.

```
systemctl status citas-whatsapp     # cómo va
journalctl -u citas-whatsapp -n 40  # por qué no va
```

Si el servicio no arranca, el despliegue NO se detiene: sin él se sigue
enviando a mano con `wa.me`, como antes de que existiera.

En local:

```
npm run whatsapp
```

## Cómo se usa

1. `/panel/configuracion?s=whatsapp` — lo ve el administrador de la oficina, no
   hace falta ser el dueño del sistema. La pantalla lleva los tres pasos
   escritos, junto al campo que empieza el primero.
2. Añadir un número con un nombre («Mostrador Hamra»).
3. **Conectar** → el código aparece solo en unos segundos; la pantalla se
   actualiza sola mientras espera.
4. Escanearlo desde el teléfono: Ajustes › Dispositivos vinculados › Vincular un
   dispositivo. Es el mismo gesto que WhatsApp Web.

El código NO está en la pantalla al abrirla: sale del paso 3, cuando WhatsApp lo
manda. La dirección del servicio y el freno quedan plegados en «Ajustes
avanzados», porque se tocan una vez cada mucho y lo que se viene a hacer aquí es
conectar un número.
5. En la pantalla del evento, **Encolar los envíos**. A quien ya se le escribió
   no se le repite.

Cada invitado recibe el mensaje en **su** idioma y con **su** enlace, la misma
regla que ya seguía el envío a mano.

### Enviar otro día

El campo **«Enviar el»** decide cuándo. Vacío es *ahora*, que es como se
comportaba toda la cola antes de existir esto. Con fecha, las filas esperan y
salen solas ese día **aunque nadie entre al panel**: una boda se anuncia el día
que la pareja decide, no el día que la oficina se sentó a preparar la lista.

Tres cosas que decide ese campo y conviene saber:

- **La hora es la de quien la escribe**, no la del servidor. Se guarda convertida
  a UTC con la zona del perfil de esa persona. Sin eso, una oficina en Costa Rica
  programando una boda de Beirut mandaría de madrugada.
- **Quien decide que ha llegado la hora es PostgreSQL**, con su propio reloj. La
  web escribe la fila y el servicio la lee: son dos procesos que pueden ir
  descuadrados, y el reloj que manda tiene que ser uno solo.
- **Un mensaje suelto de hoy adelanta a una tanda programada para el sábado.** Lo
  contrario taponaría la cola, y una cola taponada es lo que hace que nadie
  vuelva a usar la programación.

Lo programado **se ve y se cancela** mientras no haya salido: la pantalla dice
«2 invitaciones esperando a salir el domingo…» con un botón al lado. Cambió la
fecha la pareja, o alguien se equivocó de mes. Lo que ya salió no se cancela,
porque ya está en el teléfono de alguien.

### Las que no llegaron

A los tres intentos, un mensaje se rinde y queda en `failed`. El resumen ya
decía cuántas, pero solo el número: «12 fallidas» sobre doscientas preocupa y no
deja hacer nada — y a esos doce hay que escribirles a mano, así que hay que
saber quiénes son.

Ahora hay un bloque plegado con **el nombre, el teléfono y el motivo** de cada
una, y un botón para volver a encolarla —una, o todas.

- Reintentar **reinicia el contador de intentos**. Lo que se rindió a los tres se
  rendiría otra vez enseguida, y reintentar sin darle intentos no es reintentar.
- Lo pulsa **una persona**, nunca solo. Un mensaje falla por algo —el número no
  tiene WhatsApp, la sesión se cayó, el cupo del día— y reintentarlo en bucle sin
  que nadie mire es como se quema un número.
- Si el motivo es que **el número no tiene WhatsApp**, reintentar no arregla
  nada: hay que corregir el teléfono en la lista de invitados, o escribirle a
  mano con `wa.me`.

### Recordar a quien no ha contestado

Debajo del envío hay un desplegable: **cuántos días antes de la boda** se le
recuerda a quien no ha contestado. Se elige una vez y ya está.

Quien mira si toca es `citas-recordatorios.timer`, cada cuarto de hora, y lo que
hace es **encolar** — sigue mandando el servicio, de uno en uno y con su freno.
Un trabajo automático que mandara al momento es el que vacía el cupo de un número
mientras nadie mira.

Las reglas del recordatorio, que no se negocian:

- Solo a quien **no ha contestado** y **tiene teléfono**. A quien ya dijo que sí
  o que no no se le vuelve a escribir.
- **Una sola vez.** Se marca `Guest.remindedAt` en la MISMA transacción en que se
  encola: si se cayera entre las dos cosas, o se recordaría dos veces o no se
  recordaría nunca.
- **Nunca después de la boda.** Pedirle a alguien que confirme su asistencia a
  una boda que ya pasó es peor que no escribirle.
- En el idioma **del invitado**, como todo lo que sale de aquí.
- Si en ese momento no hay ningún número conectado, **no se marca a nadie**: la
  siguiente pasada lo vuelve a intentar.

## La dirección del servicio, y por qué está limitada

`WHATSAPP_GATEWAY_URL` se edita en el panel, pero **solo se acepta el bucle
local** (`127.0.0.1`, `localhost`) o lo que declare `WHATSAPP_GATEWAY_HOST` en
el **entorno** — un archivo en disco con permisos, no una fila de la base.

La razón: el token que viaja en esa llamada controla **todos los números de
todas las oficinas**. Sin este filtro, cambiar un campo de texto de la
configuración convertía el servidor en un ariete: una petición saliente a donde
quisiera el atacante, con el token dentro. Dicho corto: **el panel puede cambiar
el puerto, no la máquina.** Tampoco se siguen redirecciones, que es el mismo
problema por otra puerta.

Si el servicio corre en otra máquina, se declara así en `apps/web/.env`:

```bash
WHATSAPP_GATEWAY_HOST="wa.interno.lan"
```

## Cuando algo falla

- **«WhatsApp no respondió»** en la fila: el servidor no puede salir a
  `web.whatsapp.com`. Es lo más común en un servidor con la salida cerrada.
- **La fila dice «desconectado» y no vuelve**: alguien cerró la sesión desde el
  teléfono (Dispositivos vinculados › cerrar sesión). Hay que volver a escanear.
- **La cola no baja**: mire `/panel/sistema`; si el servicio de WhatsApp no
  responde, no está levantado.
- **Un mensaje en «fallidas»**: la fila guarda el motivo. Tras tres intentos se
  deja quieto y no se reintenta más.
