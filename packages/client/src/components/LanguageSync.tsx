import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useContextManager } from '../context/ContextManager';
import { useBusinessLanguages } from '../context/useBusinessLanguages';
import { apiClient } from '../api/client';
import { deviceChoice, deviceChoiceUnsaved, markChoiceSaved, resolveLanguage, showLanguage } from '../i18n';

/**
 * Keeps the language shown in step with who is signed in (Phase 44, design section 3.1): the System
 * persona always sees English; otherwise the account's language, else the device's choice, else the
 * browser's. Working in a business, only its languages are offered (requirement 8.3). A language picked
 * on this device while signed out is saved to the account at sign-in.
 */
export function LanguageSync() {
  const { user, setUserLanguage } = useAuth();
  const { persona, activeContext } = useContextManager();
  const business = useBusinessLanguages();
  const signedInPersona = user ? persona : null;
  const accountLanguage = user?.preferred_language ?? null;
  // The business's languages while signed in and working in a business; otherwise every language.
  const offered = user && activeContext.businessId && business.loaded ? business.languages : undefined;
  const offeredKey = offered?.join(',') ?? '';

  useEffect(() => {
    if (user && persona !== 'system' && deviceChoiceUnsaved()) {
      const choice = deviceChoice();
      markChoiceSaved();
      if (choice && choice !== accountLanguage && (!offered || offered.includes(choice))) {
        apiClient.put('/v1/profile/language', { language: choice })
          .then(() => setUserLanguage(choice))
          .catch(() => { /* stays on the device */ });
        void showLanguage(choice);
        return;
      }
    }
    void showLanguage(resolveLanguage({ persona: signedInPersona, accountLanguage, offered }));
    // user?.id: a different person signing in on the same device
  }, [user?.id, signedInPersona, accountLanguage, offeredKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
