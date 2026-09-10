import {
  addConnectionAction,
  connectAction,
  disconnectAction,
  makeDefaultAction,
  removeConnectionAction,
  setCapAction,
} from '@/app/panel/configuracion/whatsapp-actions';
import { SaveButton } from '@/components/panel/config/MailSection';
import { Field, FIELD_CLASS } from '@/components/create/Field';
import { SettingField, type SettingProps } from '@/components/panel/SettingField';
import type { ConnectionRow } from '@/lib/whatsapp/connections';
import { hasExpired, isWaiting } from '@/lib/whatsapp/waiting';
import { displayFont, latinOnly } from '@/lib/typography';
import { interpolate, type Dictionary, type Locale } from '@citas/core';

/**
 * Los números de WhatsApp de la oficina.
 *
 * El aviso va ARRIBA y no escondido en una nota al pie. Automatizar un número
 * personal para envíos masivos va contra los términos de WhatsApp, y el número
 * que pueden cerrar es el del cliente — el que sus invitados conocen. Quien
 * enciende esto tiene que leerlo antes de escanear, no después de perderlo.
 *
 * El código se dibuja en el servidor y llega como imagen: esta pantalla no
 * lleva JavaScript de cliente, como el resto del proyecto.
 */
export function WhatsappSection({
  connections,
  gatewayUrl,
  brake,
  gatewayError,
  error,
  esperando,
  canEditGateway,
  dictionary,
  locale,
}: {
  connections: ConnectionRow[];
  gatewayUrl: SettingProps;
  /** El freno: retardo mínimo, máximo y calentamiento. */
  brake: SettingProps[];
  gatewayError?: string;
  /** Lo que salió mal al añadir: `sinOficina`, `duplicate`… */
  error?: string;
  /** El número al que se le acaba de dar a Conectar, si es que hay uno. */
  esperando?: string;
  /** La dirección del servicio es de la plataforma, no de la oficina. */
  canEditGateway: boolean;
  dictionary: Dictionary;
  locale: Locale;
}) {
  const copy = dictionary.admin.whatsapp;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <p className="border border-[#8c2f1e] bg-[#fdf4f2] p-4 text-sm text-[#8c2f1e]">
        {copy.warning}
      </p>

      {gatewayError === undefined ? null : (
        <p role="alert" className="text-sm text-[#8c2f1e]">
          {copy.gatewayDown} <span className="font-mono text-xs">{gatewayError}</span>
        </p>
      )}

      {/* Por qué no se pudo añadir. Antes esto era un salto al panel sin una
          palabra, y desde fuera se ve igual que una pantalla rota. */}
      {error === undefined ? null : (
        <p role="alert" className="border border-[#8c2f1e] bg-[#fdf4f2] p-4 text-sm text-[#8c2f1e]">
          {error === 'sinOficina' ? copy.noOffice : error === 'duplicate' ? copy.duplicate : copy.gatewayDown}
        </p>
      )}

      {/* Los tres pasos, JUNTO al formulario que empieza el primero.
          Sin esto, quien abre esta pantalla buscando el código encuentra tres
          párrafos y un campo «Nombre» sin explicar para qué: el código está a
          dos pasos y nada lo decía. */}
      <section className="flex flex-col gap-4 border border-[#ddd6c6] bg-white/60 p-5">
        <h2 className={`${displayFont(locale)} text-lg`}>{copy.stepsTitle}</h2>
        <ol className="flex list-inside list-decimal flex-col gap-2 text-sm text-[#6a6456]">
          <li>{copy.step1}</li>
          <li>{copy.step2}</li>
          <li>{copy.step3}</li>
        </ol>

        <form action={addConnectionAction} className="flex flex-col gap-4 border-t border-[#ddd6c6] pt-4">
          <Field label={copy.nameLabel}>
            <input name="name" required maxLength={60} className={FIELD_CLASS} />
          </Field>
          <button
            type="submit"
            className="self-start bg-[#23201a] px-6 py-3 text-base text-[#f4efe6] hover:opacity-90"
          >
            {copy.add}
          </button>
        </form>
      </section>

      {connections.length === 0 ? (
        <p className="text-sm text-[#6a6456]">{copy.empty}</p>
      ) : (
        <ul className="flex flex-col gap-6">
          {connections.map((connection) => (
            <li key={connection.id} className="flex flex-col gap-3 border border-[#ddd6c6] bg-white/60 p-5">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className={`${displayFont(locale)} text-lg`}>{connection.name}</span>
                {connection.phone === null ? null : (
                  <span className="font-mono text-sm text-[#6a6456]" dir="ltr">
                    +{connection.phone}
                  </span>
                )}
                <span
                  className={
                    connection.status === 'connected' ? 'text-sm text-[#2f6b3a]' : 'text-sm text-[#8a6c22]'
                  }
                >
                  {copy.states[connection.status]}
                </span>
                {connection.isDefault ? (
                  <span className={`text-xs ${latinOnly(locale, 'uppercase tracking-[0.1em]')} text-[#8a6c22]`}>
                    {copy.isDefault}
                  </span>
                ) : null}
              </div>

              {connection.lastError === null ? null : (
                <p className="text-xs text-[#8c2f1e]">{connection.lastError}</p>
              )}

              <p className="flex flex-wrap gap-x-5 text-sm text-[#6a6456]">
                <span>
                  {copy.sentToday}: <span className="tabular-nums">{connection.sentToday}</span> /{' '}
                  <span className="tabular-nums">{connection.dailyCap}</span>
                </span>
                <span>
                  {copy.queued}: <span className="tabular-nums">{connection.queued}</span>
                </span>
              </p>

              {/* La espera del código va en un MARCO, y no es un capricho.
                  Esa pantallita se recarga sola con `<meta refresh>`, y ese
                  temporizador lo guarda el documento —no la etiqueta— junto con
                  la dirección que tenía al leerse. Como el panel navega sin
                  recargar la página, armarlo aquí significaba que seguía vivo
                  después de irse: se entraba al perfil y cinco segundos después
                  el navegador te devolvía a WhatsApp. Dentro del marco, el
                  documento se destruye al salir de esta pantalla y el
                  temporizador se va con él. */}
              {isWaiting(connection, esperando) ? (
                <iframe
                  src={`/qr/${connection.id}${esperando === undefined ? '' : `?esperando=${esperando}`}`}
                  title={copy.scan}
                  className="h-[27rem] w-full max-w-80 border-0"
                />
              ) : null}

              {/* Se pidió el código y no llegó nunca. Antes esto se quedaba
                  «esperando el código» para siempre, que es la forma más larga
                  de no decir nada. */}
              {hasExpired(connection, esperando) ? (
                <p className="text-sm text-[#8a6c22]">{copy.expired}</p>
              ) : null}

              <div className="flex flex-wrap items-end gap-3">
                {connection.status === 'connected' ? (
                  <form action={disconnectAction}>
                    <input type="hidden" name="id" value={connection.id} />
                    <button type="submit" className="border border-[#23201a] px-4 py-2 text-sm hover:opacity-70">
                      {copy.disconnect}
                    </button>
                  </form>
                ) : (
                  <form action={connectAction}>
                    <input type="hidden" name="id" value={connection.id} />
                    <button type="submit" className="border border-[#23201a] px-4 py-2 text-sm hover:opacity-70">
                      {copy.connect}
                    </button>
                  </form>
                )}

                <form action={setCapAction} className="flex items-end gap-2">
                  <input type="hidden" name="id" value={connection.id} />
                  <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
                    {copy.capLabel}
                    <input
                      type="number"
                      name="cap"
                      min={1}
                      max={500}
                      defaultValue={connection.dailyCap}
                      className={`${FIELD_CLASS} w-24`}
                      dir="ltr"
                    />
                  </label>
                  <button type="submit" className="border border-[#ddd6c6] px-3 py-2 text-sm hover:opacity-70">
                    {dictionary.admin.config.save}
                  </button>
                </form>

                {connection.isDefault ? null : (
                  <form action={makeDefaultAction}>
                    <input type="hidden" name="id" value={connection.id} />
                    <button type="submit" className="text-sm underline text-[#8a6c22]">
                      {copy.makeDefault}
                    </button>
                  </form>
                )}

                <form action={removeConnectionAction} className="ms-auto">
                  <input type="hidden" name="id" value={connection.id} />
                  <button type="submit" className="text-sm underline text-[#8c2f1e]">
                    {copy.remove}
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* La dirección del servicio y el freno se tocan una vez cada mucho, así
          que van plegados: lo que se viene a hacer aquí es conectar un número, y
          cinco campos técnicos delante estorban a eso. */}
      {canEditGateway ? (
        <details className="border-t border-[#ddd6c6] pt-6">
          <summary className="cursor-pointer text-sm text-[#6a6456] hover:text-[#23201a]">
            {copy.advanced}
          </summary>
        <form action={addConnectionAction} className="mt-5 flex flex-col gap-5">
          <input type="hidden" name="sector" value="whatsapp-url" />
          <SettingField {...gatewayUrl} dictionary={dictionary} />

          {/* El freno, aquí y no en el servidor: es lo que hay que tocar cuando
              un número va apretado, y para eso nadie debería entrar por SSH. El
              servicio lo relee cada minuto, así que no hay que reiniciarlo. */}
          {brake.map((field) => (
            <SettingField key={field.name} {...field} dictionary={dictionary} type="number" />
          ))}

          <SaveButton dictionary={dictionary} />
        </form>
        </details>
      ) : null}
    </div>
  );
}

export { interpolate };
