import { useEffect, useState } from 'react';
import { SUPPORTED_LANGUAGES } from '@daystream/shared';
import { useContextManager } from './ContextManager';
import { getBusinessLanguages } from '../api/translations';
import type { BusinessLanguagesData } from '../api/translations';

/**
 * The active business's languages (Phase 44, requirement 8): its default first, then the others it
 * supports. Used by the language choices about its customers and content. Until loaded, or with no
 * business, every language on the list.
 */
const cache = new Map<string, BusinessLanguagesData>();
const listeners = new Set<() => void>();

/** After the business changes its languages, so every screen shows the new list. */
export function rememberBusinessLanguages(businessId: string, data: BusinessLanguagesData): void {
  cache.set(businessId, data);
  listeners.forEach((l) => l());
}

export function useBusinessLanguages(): { languages: string[]; defaultLanguage: string; loaded: boolean } {
  const { activeContext } = useContextManager();
  const businessId = activeContext.businessId ?? null;
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((n) => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  useEffect(() => {
    if (!businessId || cache.has(businessId)) return;
    getBusinessLanguages(businessId)
      .then((data) => rememberBusinessLanguages(businessId, data))
      .catch(() => { /* keeps every language */ });
  }, [businessId]);

  const data = businessId ? cache.get(businessId) : undefined;
  return {
    languages: data?.languages ?? [...SUPPORTED_LANGUAGES],
    defaultLanguage: data?.default_language ?? SUPPORTED_LANGUAGES[0],
    loaded: !!data,
  };
}
