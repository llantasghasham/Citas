# Cobro en Líbano: Whish

**Decidido.** El cobro en Líbano se hace con Whish. Este documento es lo que hay
que pedirle a Whish para terminar la integración, y las reglas que el código ya
respeta.

---

## Qué hay construido

- `src/lib/payments/types.ts` — el dominio: importes en unidad menor, estados,
  y el *puerto* `PaymentProvider` que aísla al resto de la aplicación.
- `src/lib/payments/whish.ts` — el adaptador de Whish.
- `src/lib/payments/mock.ts` — proveedor de desarrollo, para poder construir y
  probar el flujo entero antes de tener credenciales. Se niega a arrancar en
  producción.
- `src/lib/billing/reconcile.ts` — el repaso de los cobros que se quedaron en
  «pendiente», y el ÚNICO sitio donde un pedido pasa a pagado: las tres entradas
  —el enlace de la pareja, el botón de la oficina y el trabajo periódico— pasan
  por la misma función.
- `scripts/reconcile-payments.ts` (`npm run payments:reconcile`) — ese repaso
  desde fuera, que el instalador deja corriendo cada cinco minutos con un
  temporizador del sistema (`citas-conciliar.timer`).
- `prisma/schema.prisma` — `Order`, `Payment` y `PaymentEvent`.

## El contrato, ya confirmado

Ya no es una suposición. Esto es lo que expone el servicio `itel-service` de
Whish, contrastado en varias integraciones vivas e independientes. Lo que sigue
faltando son las CREDENCIALES, no el formato.

| | |
|---|---|
| Base, producción | `https://api.whish.money/itel-service/api` |
| Base, pruebas | `https://lb.sandbox.whish.money/itel-service/api` |
| Crear cobro | `POST payment/collect` |
| Consultar estado | `POST payment/collect/status` |
| Saldo | `POST payment/account/balance` |
| Cabeceras | `channel`, `secret`, `websiteUrl` |

**Tres detalles que costaron un error cada uno** y que estaban mal en el
adaptador hasta ahora:

1. Las rutas cuelgan de `payment/`, no de la raíz.
2. La cabecera es `websiteUrl`, en camelCase. En minúsculas no autentica.
3. El estado se consulta por el `externalId` **que enviamos nosotros**, junto
   con la moneda — no por un identificador de Whish. **La moneda importa**: el
   cobro se busca por `(externalId, currency)`, así que preguntar en la moneda
   equivocada no devuelve un error, devuelve «no existe», y eso se leería como
   pendiente. Por eso la moneda viaja con la referencia desde la fila del pago,
   y no como una constante. Y ese `externalId` es
   NUMÉRICO, mientras que los identificadores de este proyecto son cuids. Por
   eso el adaptador genera uno propio y lo guarda como `providerRef`: es el
   único asa que Whish y esta aplicación comparten, y guardarlo mal dejaría un
   cobro imposible de reconciliar.

Cuerpo de `payment/collect`: `amount`, `currency`, `invoice`, `externalId`,
`successCallbackUrl`, `failureCallbackUrl`, `successRedirectUrl`,
`failureRedirectUrl`. La respuesta viene envuelta en `{ status, code, dialog,
data }` y el enlace de pago está en `data.collectUrl`. **El servicio responde
200 aunque haya rechazado la petición**: el fallo se lee en `status: false` del
cuerpo, no en el código HTTP.

## Cómo paga el cliente, y por qué importa

Whish **no permite cobrar dentro de nuestra página**. `collect` devuelve un
`collectUrl` y al pagador se le manda allí, a una página alojada por Whish.

Eso decide el diseño del producto entero:

- **No se puede incrustar** el pago en la aplicación ni en la app móvil. El
  cliente siempre sale a la página de Whish y vuelve.
- A cambio, **ningún número de tarjeta toca este servidor**, y con eso se evita
  todo el peso de cumplir PCI.
- Como el pagador es el cliente final, que NO tiene cuenta aquí, el enlace de
  pago tiene que poder abrirse sin sesión y viajar por WhatsApp, igual que las
  invitaciones.

## Cómo se abre la cuenta — confirmado por Whish

No es por correo ni por WhatsApp: **se activa desde la propia aplicación**. Esto
lo confirmó su equipo, así que no hay que adivinarlo.

1. Abrir la aplicación de Whish
2. **Business**, en la barra de abajo
3. **Activate Whish Pay**
4. Rellenar el formulario: nombre, datos de la empresa, contacto y datos del
   sitio web

Después les contacta su equipo para montar la pasarela, y ES ENTONCES cuando se
piden `channel`, `secret` y `websiteUrl` y se hacen las preguntas técnicas de
más abajo. El formulario no las contesta.

### Qué poner en «datos del sitio web»

`websiteUrl` viaja como cabecera en CADA petición, así que el dominio que se
declare aquí es el que tiene que coincidir con el de la configuración. Con dos
plataformas —`citas.posxml.com` y `posxml.com`— la pregunta de si vale una sola
cuenta o hacen falta dos se le hace al equipo cuando contacte; en el formulario
se declara el dominio con el que se va a cobrar primero.

Sea cual sea la respuesta, **el código no cambia**: cada instalación guarda su
`channel`, su `secret` y su `websiteUrl` en su propio `/panel/configuracion`.

## El mensaje para Whish, listo para pegar

Se manda por el canal OFICIAL de Whish —el botón «Business» de su propia
aplicación, o `apps.whish.money`—, nunca a un número que aparezca en un grupo.

**Qué se puede decir y qué no.** El **Account ID** y el teléfono registrado SÍ:
es como te identifican y no son secretos. La **clave (`secret`) NO se manda
nunca de vuelta**, ni siquiera a alguien que diga ser soporte: ellos te la dan a
ti, no al revés. Si alguna vez alguien te la pide, no es soporte.

### Primer mensaje

Va todo de una vez: quién eres, las DOS plataformas, y lo de recibir el código
estando fuera del Líbano. Preguntarlo por partes son tres conversaciones que
empiezan de cero cada una.

Si ya contestaron mandando a **Business → Activate Whish Pay**, este mensaje
sigue valiendo como respuesta: deja por escrito lo que el formulario NO pregunta
—los dos dominios, el Individual/Corporate y el código estando fuera del
Líbano— para que el equipo llegue con las respuestas preparadas.

Ojo con una cosa que decide la configuración: `websiteUrl` viaja como cabecera
en CADA petición, así que si los dos dominios comparten cuenta de comercio o
necesitan una cada uno es una pregunta técnica, no administrativa. Sea cual sea
la respuesta, **el código no cambia**: cada instalación guarda su `channel`, su
`secret` y su `websiteUrl` en su propio `/panel/configuracion`.

> مرحبًا، أنا صاحب الحساب رقم **[Account ID]** المسجّل على الرقم **[الهاتف]**.
>
> عندي **منصّتين** وبدّي فعّل الدفع عبر Whish Collect عليهما:
> • **citas.posxml.com** — بطاقات دعوات رقمية
> • **posxml.com** — نظام نقاط بيع وفوترة
>
> ١) بحاجة لفتح **حساب تاجر (Merchant / Business)** والحصول على `channel`
> و`secret` و`websiteUrl` للتجربة (sandbox) وللإنتاج، مع نسخة من
> **Whish Collect Web Service Technical Specification**.
>
> ٢) هل يكفي **حساب تاجر واحد للنطاقين**، أم يلزم `channel` و`websiteUrl`
> منفصلان لكل نطاق؟
>
> ٣) حسابي الحالي مسجّل كـ *Individual* — هل يلزم تحويله إلى *Corporate*؟ وما
> الأوراق المطلوبة؟
>
> ٤) أنا لبناني ومقيم في **كوستاريكا**، وأسافر بين البلدين. عندي رقم كوستاريكي
> **[الرقم الثاني]**. كيف أستلم **رمز التحقّق (OTP)** وأنا خارج لبنان؟ هل يمكن
> إضافة رقم ثانٍ للحساب، أو استلام الرمز على البريد الإلكتروني، أو تأكيد
> الدخول من داخل التطبيق دون رسالة نصّية؟
>
> وشكرًا.

En inglés, por si contestan en inglés:

> Hello. I am the holder of account **[Account ID]**, registered to
> **[phone]**.
>
> I run **two platforms** and I would like to collect payments through Whish
> Collect on both:
> • **citas.posxml.com** — digital invitation cards
> • **posxml.com** — point-of-sale and invoicing
>
> 1. I need to open a **merchant (business) account** and receive the
>    `channel`, `secret` and `websiteUrl` for sandbox and production, together
>    with the **Whish Collect Web Service Technical Specification**.
> 2. Is **one merchant account enough for both domains**, or does each domain
>    need its own `channel` and `websiteUrl`?
> 3. My account is registered as *Individual* — does it need to become
>    *Corporate*? Which documents are required?
> 4. I am Lebanese and **resident in Costa Rica**, travelling between the two.
>    I have a Costa Rican number, **[second number]**. How do I receive the
>    **OTP** while outside Lebanon? Can a second number be added to the
>    account, can the code be sent by email, or can login be confirmed inside
>    the app without an SMS?
>
> Thank you.

### Segundo mensaje, cuando ya haya cuenta

La pregunta 3 es la cara: contestarla mal cobra cien veces de más o cien veces
de menos. No se cierra sin respuesta POR ESCRITO.

> 1. `channel`, `secret` و`websiteUrl` — للـ sandbox وللإنتاج.
> 2. الوثيقة التقنية لـ Whish Collect، آخر نسخة.
> 3. **صيغة المبلغ**: هل `amount` بالوحدة الكاملة (20 = عشرون دولارًا) أم
>    بالسنتات (2000 = عشرون دولارًا)؟ وأي عملات مدعومة؟
> 4. هل يوجد **callback** من خادم إلى خادم؟ وهل هو **موقّع**؟ بأي ترويسة وأي
>    خوارزمية نتحقّق من التوقيع؟
> 5. إذا أُرسل نفس `externalId` مرّتين: هل يُنشأ تحصيل ثانٍ أم يُعاد الأول؟
> 6. متى تنتهي صلاحية طلب تحصيل غير مدفوع؟
> 7. العمولة، ودورة التسوية، وإلى أي حساب.
> 8. الحدود لكل عملية ولكل يوم.

Y en inglés:

> 1. `channel`, `secret` and `websiteUrl` — for sandbox and for production.
> 2. The latest Whish Collect technical specification document.
> 3. **Amount format**: is `amount` in whole currency units (20 = twenty
>    dollars) or in cents (2000 = twenty dollars)? Which currencies?
> 4. Is there a **server-to-server callback**? Is it **signed**? With which
>    header and which algorithm do we verify the signature?
> 5. If the same `externalId` is sent twice, is a second collection created or
>    is the first one returned?
> 6. How long before an unpaid collection expires?
> 7. Fee, settlement cycle, and to which account.
> 8. Limits per transaction and per day.

Lo que contesten a la 3 se comprueba igual con un cobro real de un dólar mirado
en el panel de Whish. Una respuesta por WhatsApp no es una prueba.

## Al abrir la cuenta de comercio, pedir por escrito:

1. **Credenciales de sandbox y de producción**: `channel`, `secret` y
   `websiteUrl`. Es lo único que bloquea hoy.
2. La **«Whish Collect Web Service Technical Specification»**, última versión,
   para confirmar por escrito lo que ya está en la tabla de arriba.
3. **Endpoints y nombres de campo exactos** para: crear un cobro, consultar su
   estado, consultar tipo de cambio y consultar saldo.
4. **Cómo se notifica el pago.** ¿Hay callback de servidor a servidor? ¿Va
   firmado? ¿Con qué cabecera y qué algoritmo se verifica la firma? *(Si no va
   firmado, el callback no puede decidir nada por sí solo — ver reglas abajo.)*
5. **Monedas soportadas y formato del importe.** ¿USD y LBP? ¿El importe va en
   céntimos o en unidades enteras? **Esta es la pregunta cara.** Dentro, el
   dinero son enteros en la unidad menor: 2000 son veinte dólares. El adaptador
   envía 20, no 2000 (`toProviderAmount()`), porque una API que pide `currency`
   al lado del `amount` casi siempre espera las unidades normales. Es una
   suposición. Se eligió así por lo que cuesta fallar: si Whish quisiera
   céntimos, cobra 0,20 $ en vez de 20 $ y se ve en el primer cobro de prueba;
   al revés, le cobraría 2.000 $ a una pareja. **El primer cobro real, de un
   dólar, hay que mirarlo en el panel de Whish antes de vender nada.**
6. **Idempotencia.** Si se envía dos veces el mismo `externalId`, ¿se crea un
   segundo cobro o devuelve el primero?
7. **Caducidad** de un cobro sin pagar.
8. **Devoluciones.** ¿Hay API de reembolso o se hace a mano?
9. **Comisión y liquidación.** Cuánto se llevan, cada cuánto liquidan y a qué
   cuenta.
10. **Límites** por transacción y por día.

## Reglas de la integración

Estas ya están en el código y no se negocian:

- **El navegador nunca decide un pago.** Que el pagador vuelva a la URL de éxito
  no significa que haya pagado. Se confirma preguntándole al proveedor.
- **El callback es un aviso, no una prueba.** Mientras no haya una firma que
  podamos verificar, el callback solo dice *qué pedido mirar*; quien decide es
  `getStatus()`, servidor contra servidor.
- **Idempotencia por pedido.** `(provider, providerRef)` es único, y además hay
  un índice único PARCIAL que solo permite UN cobro `pending` por `(orderId,
  provider)`. Está en la base y no solo en el código a propósito: dos peticiones
  simultáneas comprueban las dos que no hay ninguno abierto y las dos lo crean.
  Un doble clic reutiliza el enlace guardado en `Payment.payUrl` en vez de abrir
  una segunda cobranza.
- **El aviso pasa por el mismo sitio que todo lo demás.** `applySettlement` es la
  única puerta por la que un pedido pasa a pagado, y es atómica, monótona e
  idempotente: una transacción con la fila bloqueada, `paid` terminal salvo
  reembolso, y el mismo aviso dos veces no activa nada dos veces.
- **Conciliación.** `citas-conciliar.timer` repasa cada cinco minutos los cobros
  que llevan más de dos minutos en `pending` y le pregunta al proveedor. Los
  callbacks se pierden; el dinero no puede perderse con ellos. Los recién
  abiertos se dejan en paz —al pagador le acaban de abrir la pasarela—, los de
  más de un mes también, y el efectivo no entra: no hay a quién preguntarle.
  Cada cambio deja un `PaymentEvent` que dice si vino del enlace, del panel o
  del repaso.
- **Todo evento se guarda crudo** en `PaymentEvent`. Cuando un cobro se discute
  —y se discute—, es lo único que sirve.
- **Importes en entero.** Céntimos en USD, unidades en LBP. Ningún decimal toca
  dinero.

## El día que contesten: qué hacer, en orden

Lo de arriba es lo que hay que PREGUNTAR. Esto es lo que hay que HACER cuando
lleguen las credenciales, y en este orden, porque cada paso protege al
siguiente.

1. **Poner las credenciales en el panel**, no en el `.env`.
   `/panel/configuracion?s=payments` → dirección del servicio, canal, dominio y
   clave secreta. La clave se escribe y no se vuelve a leer: se guarda cifrada.
   Empezar por la dirección de **sandbox** si la dan.
2. **Pulsar «Probar el cobro»** en esa misma pantalla. Pregunta el saldo, que es
   una operación de solo lectura: dice si las credenciales valen sin mover un
   céntimo. Si contesta, el `channel`, el `secret` y el `websiteUrl` son
   correctos y la cabecera va bien escrita.
3. **Un cobro real de UN dólar**, y mirarlo en la aplicación de Whish. Esto es
   lo único que resuelve la pregunta del importe: si en Whish aparece **1,00 $**,
   `amount` va en unidades y el código está bien; si aparece **0,01 $**, Whish
   quiere céntimos y hay que quitar la división de `toProviderAmount()`. Una
   respuesta por WhatsApp no sustituye a esto.
4. **Encender el medio de pago** en `/panel/configuracion?s=payments`
   (`PAYMENT_METHODS`). Hasta aquí no hay nada que un cliente pueda pulsar.
5. **Comprobar que el repaso corre**: `systemctl status citas-conciliar.timer`.
   Es lo que recoge un pago cuyo aviso se perdió.
6. **Vender uno de verdad** y mirar el pedido en el panel. No se anuncia el
   cobro hasta que un pedido de verdad haya llegado a «pagado» solo.

## Qué queda pendiente HOY

| | |
|---|---|
| Formulario de Whish Pay | **enviado**, esperando a su equipo |
| `channel`, `secret`, `websiteUrl` | **faltan** — es lo único que bloquea |
| Formato del importe | **por confirmar** con el cobro de un dólar |
| Callback firmado | **por confirmar**; mientras no lo esté, el callback solo avisa |
| Código de acceso estando fuera del Líbano | **por resolver** con ellos |

Nada de eso es código. El adaptador, el repaso, la pantalla de pago y el enlace
para la pareja están construidos y probados contra un Whish de mentira que imita
el sobre `{ status, code, dialog, data }`, el 200-con-`status:false` y la
búsqueda por `(externalId, currency)`.

## Dónde va la configuración

En el **panel**, no en el `.env`: `/panel/configuracion?s=payments`. Es la regla
del proyecto —quien monta esto no debería abrir un archivo por SSH para cambiar
una pasarela— y la clave secreta se guarda cifrada con la llave fuera de la base
de datos.

El `.env` se sigue leyendo como RESPALDO, y solo como respaldo: si el valor está
guardado en el panel, manda el panel.

```bash
PAYMENTS_PROVIDER=whish        # 'mock' en desarrollo; prohibido en producción
WHISH_BASE_URL=https://…       # sandbox o producción, según entorno
WHISH_CHANNEL=…
WHISH_WEBSITE_URL=https://…
WHISH_SECRET_ENC=v1.…          # cifrada: npm run secret:encrypt
```

## Lo que sigue faltando

Whish resuelve el cobro por billetera, que es el grueso del cliente libanés.
Para **tarjeta** sigue abierto Areeba o Tap, y para quien paga en efectivo, OMT.
Eso se añade como un segundo proveedor detrás del mismo puerto, sin tocar la
aplicación.
