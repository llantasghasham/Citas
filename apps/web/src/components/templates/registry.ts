import type { ComponentType } from 'react';

import type { TemplateId } from '@/lib/types';

import { ClassicGold } from './classic-gold/ClassicGold';
import { SoberMemorial } from './sober-memorial/SoberMemorial';
import type { TemplateProps } from './types';

/** Adding a template means adding an id to TEMPLATE_IDS and an entry here. */
export const TEMPLATES: Record<TemplateId, ComponentType<TemplateProps>> = {
  'classic-gold': ClassicGold,
  'sober-memorial': SoberMemorial,
};
