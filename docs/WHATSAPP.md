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
WHATSAPP_DELAY_MIN=8      # segundos
WHATSAPP_DELAY_MAX=25
WHATSAPP_WARMUP_CAP=20
DATABASE_URL=             # la misma que la web
CITAS_SECRET_KEY_FILE=    # la misma que la web
```

La dirección del servicio (`WHATSAPP_GATEWAY_URL`) sí se configura en el panel,
porque no es un secreto.

Arrancarlo:

```
npm run whatsapp
```

En producción va como servicio de systemd, con `Restart=always`.

## Cómo se usa

1. `/panel/configuracion?s=whatsapp` — lo ve el administrador de la oficina, no
   hace falta ser el dueño del sistema.
2. Añadir un número con un nombre («Mostrador Hamra»).
3. **Conectar** → aparece el código.
4. Escanearlo desde el teléfono: Ajustes › Dispositivos vinculados › Vincular un
   dispositivo. Es el mismo gesto que WhatsApp Web.
5. En la pantalla del evento, **Encolar los envíos**. A quien ya se le escribió
   no se le repite.

Cada invitado recibe el mensaje en **su** idioma y con **su** enlace, la misma
regla que ya seguía el envío a mano.

## Cuando algo falla

- **«WhatsApp no respondió»** en la fila: el servidor no puede salir a
  `web.whatsapp.com`. Es lo más común en un servidor con la salida cerrada.
- **La fila dice «desconectado» y no vuelve**: alguien cerró la sesión desde el
  teléfono (Dispositivos vinculados › cerrar sesión). Hay que volver a escanear.
- **La cola no baja**: mire `/panel/sistema`; si el servicio de WhatsApp no
  responde, no está levantado.
- **Un mensaje en «fallidas»**: la fila guarda el motivo. Tras tres intentos se
  deja quieto y no se reintenta más.
