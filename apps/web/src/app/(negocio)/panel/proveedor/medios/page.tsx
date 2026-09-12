import { redirect } from 'next/navigation';

import { PanelNotice } from '@/components/directory/PanelNotice';
import { ProviderStatus } from '@/components/directory/ProviderStatus';
import { getSession } from '@/lib/auth/session';
import { listMedia, MAX_IMAGES } from '@/lib/directory/media';
import { currentProviderScope, panelLocale } from '@/lib/directory/session';
import { getDirectoryDictionary } from '@citas/core';

import {
  moveMediaAction,
  removeMediaAction,
  setAltTextAction,
  setVideoAction,
  uploadImageAction,
} from '../actions';

interface Props {
  searchParams: Promise<{ p?: string; error?: string; guardado?: string }>;
}

const CAJA = 'w-full border border-[#ddd6c6] bg-white px-3 py-2 text-sm text-[#23201a]';
const BOTON = 'bg-[#8a6c22] px-4 py-2 text-sm text-[#fbf6ec] hover:opacity-90';
const SECUNDARIO = 'border border-[#ddd6c6] bg-white px-3 py-1 text-xs hover:bg-[#f4efe6]';

/** Las fotos y el vídeo. Diez huecos, y lo que hay en cada uno. */
export default async function ProviderMediaPage({ searchParams }: Props) {
  const [session, params] = await Promise.all([getSession(), searchParams]);
  if (session === null) redirect('/entrar');

  const locale = panelLocale(undefined, session.locale);
  const copy = getDirectoryDictionary(locale);

  const scope = await currentProviderScope(session.userId, params.p);
  if (scope === null) redirect('/panel/proveedor');

  const media = await listMedia(scope);
  const imagenes = media.filter((one) => one.kind === 'image');
  const video = media.find((one) => one.kind === 'video');
  const oculto = <input type="hidden" name="providerId" value={scope.providerId} />;

  return (
    <>
      <header className="flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-2xl">{copy.panel.media}</h1>
        <span className="text-xs text-[#6a6456]">
          {copy.panel.slotsLeft.replace('{count}', String(MAX_IMAGES - imagenes.length))}
        </span>
      </header>

      <PanelNotice params={params} copy={copy} />
      <p className="text-sm text-[#6a6456]">{copy.panel.mediaHelp}</p>

      {imagenes.length < MAX_IMAGES && (
        <form
          action={uploadImageAction}
          encType="multipart/form-data"
          className="flex flex-wrap items-end gap-3 border border-[#ddd6c6] bg-[#fbf6ec] p-4"
        >
          {oculto}
          <input
            type="file"
            name="file"
            accept="image/*"
            required
            className="text-sm text-[#23201a]"
          />
          <button type="submit" className={BOTON}>
            {copy.panel.upload}
          </button>
        </form>
      )}

      <ul className="flex flex-col gap-3">
        {imagenes.map((one, index) => (
          <li key={one.id} className="flex flex-wrap items-start gap-4 border border-[#ddd6c6] bg-white p-3">
            {/* La miniatura pasa por la ruta que mira el estado, no por una
                dirección del almacén: una foto retirada tiene que dejar de verse
                también aquí. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- son bytes
                que sirve este mismo proceso, con su propia comprobación de
                permiso; el optimizador de Next no pinta nada aquí. */}
            <img
              src={`/api/d/media/${one.id}?t=1`}
              alt={one.altText ?? ''}
              width={96}
              height={96}
              className="h-24 w-24 shrink-0 object-cover"
            />

            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-x-3">
                <ProviderStatus status={one.status} copy={copy} />
                {one.hiddenReason !== null && (
                  <span className="text-xs text-[#8a3a22]">{one.hiddenReason}</span>
                )}
                {one.width !== null && (
                  <span className="text-xs text-[#6a6456]">
                    {one.width}×{one.height}
                  </span>
                )}
              </div>

              <form action={setAltTextAction} className="flex flex-wrap items-end gap-2">
                {oculto}
                <input type="hidden" name="mediaId" value={one.id} />
                <label className="flex flex-1 flex-col gap-1 text-xs text-[#6a6456]">
                  {copy.panel.altText}
                  <input
                    name="altText"
                    defaultValue={one.altText ?? ''}
                    maxLength={200}
                    className={CAJA}
                  />
                </label>
                <button type="submit" className={SECUNDARIO}>
                  {copy.panel.save}
                </button>
              </form>
            </div>

            <div className="flex shrink-0 flex-col gap-1">
              {index > 0 && (
                <form action={moveMediaAction}>
                  {oculto}
                  <input type="hidden" name="mediaId" value={one.id} />
                  <input type="hidden" name="direction" value="up" />
                  <button type="submit" className={SECUNDARIO}>
                    {copy.panel.up}
                  </button>
                </form>
              )}
              {index < imagenes.length - 1 && (
                <form action={moveMediaAction}>
                  {oculto}
                  <input type="hidden" name="mediaId" value={one.id} />
                  <input type="hidden" name="direction" value="down" />
                  <button type="submit" className={SECUNDARIO}>
                    {copy.panel.down}
                  </button>
                </form>
              )}
              <form action={removeMediaAction}>
                {oculto}
                <input type="hidden" name="mediaId" value={one.id} />
                <button type="submit" className={`${SECUNDARIO} text-[#8a3a22]`}>
                  {copy.panel.remove}
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>

      <form action={setVideoAction} className="flex flex-col gap-3 border border-[#ddd6c6] bg-[#fbf6ec] p-4">
        {oculto}
        <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
          {copy.panel.videoUrl}
          <input
            name="videoUrl"
            defaultValue={video?.externalUrl ?? ''}
            maxLength={300}
            dir="ltr"
            className={CAJA}
          />
          <span className="opacity-70">{copy.panel.videoHelp}</span>
        </label>
        {video !== undefined && <ProviderStatus status={video.status} copy={copy} />}
        <button type="submit" className={`${BOTON} self-start`}>
          {copy.panel.save}
        </button>
      </form>
    </>
  );
}
