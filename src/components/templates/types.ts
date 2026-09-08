import type { Dictionary, Invitation } from '@/lib/types';

export interface TemplateProps {
  invitation: Invitation;
  dictionary: Dictionary;
  /** Web page: links are live. PNG export: links are omitted. */
  interactive: boolean;
}
