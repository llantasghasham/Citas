import type { DirectoryDictionary } from '@citas/core';

/**
 * En qué estado está el negocio, dicho en una palabra.
 *
 * Los estados son los de la base y se traducen aquí. El único verde es
 * `approved`: todo lo demás significa que no se ve en el directorio, y eso es lo
 * que quien administra tiene que poder leer de un vistazo.
 */
export function ProviderStatus({
  status,
  copy,
}: {
  status: string;
  copy: DirectoryDictionary;
}) {
  const texto: Record<string, string> = {
    draft: copy.panel.statusDraft,
    pending_review: copy.panel.statusPending,
    approved: copy.panel.statusApproved,
    rejected: copy.panel.statusRejected,
    suspended: copy.panel.statusSuspended,
    hidden: copy.panel.statusHidden,
  };
  const color = status === 'approved' ? 'text-[#2f6b3a]' : 'text-[#8a3a22]';
  return <span className={`text-xs ${color}`}>{texto[status] ?? status}</span>;
}
