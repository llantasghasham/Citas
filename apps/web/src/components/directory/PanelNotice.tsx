import type { DirectoryDictionary } from '@citas/core';

/**
 * Lo que salió de la última acción.
 *
 * Los códigos de error vienen del servicio y se traducen aquí: una acción no
 * escribe frases, escribe motivos — así el mismo motivo se lee en cinco idiomas
 * sin que la acción sepa en cuál se está trabajando. Un código que no esté en el
 * diccionario se enseña tal cual en vez de callarse: un error mudo es peor que
 * uno feo.
 */
export function PanelNotice({
  params,
  copy,
}: {
  params: { error?: string; guardado?: string; creado?: string; enviado?: string };
  copy: DirectoryDictionary;
}) {
  if (params.error !== undefined) {
    const errores = copy.panel.errors as unknown as Record<string, string>;
    return (
      <p className="border border-[#8a3a22] bg-[#fbeee9] px-4 py-2 text-sm text-[#8a3a22]">
        {params.error
          .split(',')
          .map((one) => errores[one] ?? one)
          .join(' ')}
      </p>
    );
  }

  if (params.enviado !== undefined) {
    return (
      <p className="border border-[#2f6b3a] bg-[#eef6ef] px-4 py-2 text-sm text-[#2f6b3a]">
        {copy.panel.submitHelp}
      </p>
    );
  }

  if (params.guardado !== undefined || params.creado !== undefined) {
    return (
      <p className="border border-[#2f6b3a] bg-[#eef6ef] px-4 py-2 text-sm text-[#2f6b3a]">
        {copy.panel.saved}
      </p>
    );
  }
  return null;
}
