import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { apiClient } from '../api/client';

interface BusinessSettings {
  schedulingMode: string;
}

interface BusinessSettingsContextType {
  settings: BusinessSettings;
  refresh: () => void;
}

const BusinessSettingsContext = createContext<BusinessSettingsContextType>({
  settings: { schedulingMode: 'availability' },
  refresh: () => {},
});

export function BusinessSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<BusinessSettings>({ schedulingMode: 'availability' });

  const refresh = useCallback(() => {
    const businessId = localStorage.getItem('business_id');
    if (!businessId) return;
    apiClient.get(`/v1/admin/businesses/${businessId}/settings`)
      .then((res) => {
        const data = res.data.data;
        if (data) setSettings({ schedulingMode: data.scheduling_mode || 'availability' });
      })
      .catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <BusinessSettingsContext.Provider value={{ settings, refresh }}>
      {children}
    </BusinessSettingsContext.Provider>
  );
}

export function useBusinessSettings() {
  return useContext(BusinessSettingsContext);
}
