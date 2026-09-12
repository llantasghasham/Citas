# Probarlo todo en producción

Una boda de prueba, de principio a fin, en `https://citas.posxml.com`. Unos
cuarenta minutos. Al final se borra y no queda nada.

Está escrito para hacerlo con el móvil al lado: hay dos pasos —el enlace del
invitado y el QR— que **solo** se pueden comprobar con un teléfono de verdad, y
son justo los que nadie puede comprobar por usted.

**Regla de oro:** todo lo de esta prueba lleva la palabra `PRUEBA` en el nombre.
Si algo sale mal a mitad, se sabe qué borrar.

---

## Antes de empezar

- [ ] Entre en `https://citas.posxml.com/entrar` con su correo de
      superadministrador. Si tiene contraseña, úsela; si no, pida el código y
      revise la bandeja.
- [ ] Abra `https://citas.posxml.com/panel/sistema`. Son once comprobaciones.
      **Anote las que salgan en rojo antes de tocar nada**: si algo falla
      después, hay que saber si ya estaba roto.

> Si no le llega el código por correo, el problema es el SMTP y no lo nuevo.
> Está en `/panel/configuracion?s=correo`, con un botón que manda una prueba y
> enseña la respuesta del servidor.

---

## 1. Crear la boda

`https://citas.posxml.com/crear`

- [ ] Tipo: **boda**. Novios: `PRUEBA Uno` y `PRUEBA Dos`.
- [ ] Fecha: **dentro de dos meses**. Hora: `19:00`. Zona: `Asia/Beirut`.
- [ ] Salón: `PRUEBA Salón`, dirección cualquiera.
- [ ] Idioma: **árabe**.
- [ ] Publique.

**Qué tiene que pasar:** el formulario entero se pone en árabe y de derecha a
izquierda en cuanto elige el idioma. La vista previa de la tarjeta que ve es la
MISMA que se publica — no una maqueta.

❌ Si el formulario se queda en español, lo del idioma está roto.

Apunte la dirección que le queda: `…/i/<slug>`.

---

## 2. Los actos

En `/panel`, entre en la boda y pulse **Actos**.

- [ ] Añada **حنة (henna)**: el día ANTERIOR a la boda, `20:00`, en
      `PRUEBA Casa de la novia`, visibilidad **por grupos**.
- [ ] Añada **الزفاف (ceremonia)**: el día de la boda, `17:00`, visibilidad
      **por grupos**.
- [ ] Añada **الحفل (recepción)**: el día de la boda, `19:00`, en
      `PRUEBA Salón`, visibilidad **pública**. Márquelo como **principal**.
- [ ] Súbalos y bájelos con las flechas y compruebe que se quedan en el orden
      que usted quiere.

**Qué tiene que pasar:** tres actos, con tres fechas y dos sedes distintas.

❌ Si al quitar un acto se rompe algo, pare y avise: eso ya pasó una vez con las
mesas.

---

## 3. Los invitados

Vuelva al evento. En **Importar**, pegue esto tal cual:

```
Nombre,Teléfono,Idioma
رامي حداد,81851000,ar
ليلى حداد,81851001,ar
سامي خوري,81851002,ar
Colega PRUEBA,81851003,es
Sin teléfono PRUEBA,,ar
,81851004,ar
```

- [ ] Prefijo: **+961**.

**Qué tiene que pasar:** importa **5** y descarta **1** (la línea sin nombre, y
lo dice). Los teléfonos quedan como `+96181851000`, no como `81851000`.

❌ Si importa 6, la línea vacía se está colando.
❌ Si los teléfonos no llevan `+961`, el prefijo no se está aplicando.

- [ ] Pegue la MISMA lista otra vez. Tiene que decir que no añadió a nadie: se
      reconoce por teléfono. **Esto es lo que evita doscientos duplicados el día
      que alguien pega la lista dos veces.**

---

## 4. Repartir por acto

En **Actos**, abajo, en los grupos:

- [ ] Cree el grupo **عائلة العروس**.
- [ ] Meta dentro a los tres árabes; deje fuera al «Colega PRUEBA».
- [ ] En la **henna**, dé **permitir** a ese grupo.
- [ ] En la **ceremonia**, dé **permitir** a ese grupo.
- [ ] La **recepción** es pública: no toca nada.

**Qué tiene que pasar:** el grupo «عائلة العروس» sale con la clave `grupo` o
`grupo-2`, **no** con el apellido transliterado. Es a propósito.

- [ ] Use la **vista previa** de «qué ve este invitado» con el Colega y con رامي.

**Qué tiene que pasar:** el Colega ve **1** acto; رامي ve **3**.

❌ Si el Colega ve la henna, el reparto no funciona y **ese es el fallo más
grave que puede tener este producto**: la henna íntima de una familia en la
pantalla de un compañero de trabajo.

---

## 5. Lo que ve el invitado — CON EL MÓVIL

En la lista de invitados, cada uno tiene su enlace `…/g/<token>`.

- [ ] Copie el de **رامي** y ábralo **en el móvil**.
- [ ] Copie el del **Colega PRUEBA** y ábralo **en otro navegador** (o en
      ventana privada, o el móvil de otra persona).

**Qué tiene que pasar en el de رامي:**
- La tarjeta en árabe, de derecha a izquierda, y se lee bien en una pantalla de
  móvil.
- Debajo, **el programa con tres actos**, cada uno con su fecha y su sede.
- Debajo, **cuatro preguntas**: qué come, cómo llega, qué necesita para moverse
  y si quiere salir en las fotos. Todas con opciones, ninguna con caja de texto.

**Qué tiene que pasar en el del Colega:** **un solo acto**, la recepción.

❌ Si el Colega ve tres, vuelva al paso 4.
❌ Si la tarjeta se sale de la pantalla o el árabe sale con letras separadas,
anótelo con una captura: es exactamente la revisión visual que falta.

---

## 6. Responder

Con el enlace de رامي, en el móvil:

- [ ] En la **henna**: **sí**, 3 personas.
- [ ] En la **recepción**: **sí**, 3 personas.
- [ ] En la **ceremonia**: **no**.
- [ ] En las preferencias: **sin gluten** y **necesito que me lleven**.
- [ ] Recargue la página.

**Qué tiene que pasar:** todo sigue puesto. El invitado no tiene cuenta: lo
recuerda el enlace.

- [ ] Cambie la henna a **4 personas**. Tiene que dejarle.

Con el enlace del Colega:
- [ ] Responda a la recepción: **sí**, 2 personas.

---

## 7. Lo que hay que preparar

En el evento, **Lo que necesitan**.

**Qué tiene que pasar:** «En la mesa» dice **1 sin gluten**; «Cómo llega» dice
**1 necesito que me lleven**. Son recuentos, no nombres — es lo que se le pasa
al catering.

- [ ] Cambie el acto de arriba a **la henna** y pulse Ver. Los números son los
      de quien entra a la henna, no los de toda la boda.

---

## 8. El QR y la puerta — CON EL MÓVIL

En el evento, **Puerta del evento**.

- [ ] Elija la **henna** y pulse **Códigos para imprimir**.
- [ ] **Imprima la hoja** (o ábrala en otra pantalla).

**Qué tiene que pasar:** un recuadro por cada invitado autorizado a la henna
—los tres árabes, no el Colega—, con su nombre y **el nombre del acto en cada
recuadro**. La cabecera del panel no se imprime.

- [ ] **Escanee con la cámara del móvil** el QR de رامي. Tiene que leer un texto
      que empieza por `g1.`.
- [ ] Copie ese texto en el campo de la puerta, con la **henna** elegida, 4
      personas. Pulse anotar.

**Qué tiene que pasar:** «Entró رامي, 4».

- [ ] Léalo **otra vez**. Tiene que decir **«ya entró»** y la hora, y nada más.
- [ ] Ahora cambie el acto a **la recepción** y pegue **el mismo código**.

**Qué tiene que pasar:** **no lo acepta.** El código de la henna no abre la
recepción. Si lo acepta, avise: la firma por acto no está funcionando.

- [ ] Pruebe con un invitado y **9 personas**. Tiene que decir que trae más de
      los autorizados.
- [ ] Deshaga la entrada de رامي. Tiene que poder volver a entrar.

---

## 9. Exportar y el calendario

- [ ] En el evento, exporte la lista. Ábrala **en Excel**.

**Qué tiene que pasar:** los nombres en árabe se leen bien. Si salen como
`Ø±Ø§Ù…ÙŠ`, falta la marca de orden de bytes y hay que avisar.

- [ ] Exporte la lista **de la henna** desde el acto. Tiene tres filas, no cinco.
- [ ] Abra `https://citas.posxml.com/api/calendar/<slug>` y añádalo al
      calendario del móvil.

**Qué tiene que pasar:** **tres citas**, cada una con su hora y su sede, en el
idioma del invitado.

---

## 10. Dos oficinas no se ven

Esto es lo que vende el producto, así que conviene comprobarlo a mano.

- [ ] En `/panel/oficinas`, cree una oficina `PRUEBA-B`.
- [ ] Cree en ella un usuario administrador con **otro correo suyo**.
- [ ] Entre con ESE usuario (en otro navegador).

**Qué tiene que pasar:** no ve la boda de prueba. Ni en la lista, ni buscándola.

- [ ] Con ese usuario, pegue en la barra la dirección del evento de la otra
      oficina: `/panel/eventos/<id>`.

**Qué tiene que pasar:** le echa al panel. **No** le enseña el evento.

❌ Si lo ve, pare todo y avise inmediatamente. Eso es lo único de esta lista que
es un incidente y no un fallo.

---

## 11. Permisos y envíos — MIRE, NO MANDE

- [ ] Abra **Permiso para escribir**. Sale quién dio permiso y quién no.
- [ ] Abra **Envíos**, elija la henna y **vea a quién le llegaría**.

**Qué tiene que pasar:** los que no tienen permiso salen **con nombre** y con el
motivo. La pantalla de ver **no manda nada**: mirar es un `GET`.

⚠️ **No pulse mandar** con un número de WhatsApp conectado si no quiere que
salgan mensajes de verdad. Si quiere probar el envío entero, hágalo con un
evento con **un solo invitado, y que sea su propio teléfono**.

---

## 12. Recoger

- [ ] Borre la boda de prueba desde el panel.
- [ ] Borre la oficina `PRUEBA-B`.
- [ ] Vuelva a `/panel/sistema` y compare con lo que anotó al principio.

---

## Lo que esta prueba NO cubre

Dígalo cuando alguien pregunte si «está probado»:

- **El cobro con Whish.** Sin la especificación del proveedor no hay nada que
  probar de verdad.
- **SINPE Móvil.** El lector no ha leído nunca un correo real de su banco. Puede
  pegar uno a mano en `/panel/configuracion?s=sinpe` — es la única forma de
  comprobar los patrones de SU banco antes de confiarle un cobro, y merece la
  pena hacerlo antes que ninguna otra cosa de dinero.
- **El envío masivo por WhatsApp** con doscientos invitados de verdad.
- **Una boda real**, con sus doscientas personas, sus cuatro actos y su día.
  Eso no lo sustituye ninguna lista.

## Si algo falla

Apunte tres cosas y nada más: **qué pantalla**, **qué hizo** y **qué salió**
—con captura si es una pantalla—. Con eso se arregla; con «no funciona», no.
