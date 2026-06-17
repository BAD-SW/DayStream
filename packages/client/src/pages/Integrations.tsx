import { useState, useEffect } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import * as integrationsApi from '../api/integrations';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
  connected: 'success', disconnected: 'neutral', error: 'error', expired: 'warning', not_connected: 'neutral',
};

export function Integrations() {
  const [marketplace, setMarketplace] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    integrationsApi.getMarketplace().then(setMarketplace).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const categories = [...new Set(marketplace.map((i: any) => i.category))];

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-6">Integrations</h1>
      {loading ? <div>Loading...</div> : (
        categories.map((cat) => (
          <div key={cat} className="mb-8">
            <h2 className="text-lg font-medium mb-3 capitalize">{cat}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {marketplace.filter((i: any) => i.category === cat).map((item: any) => (
                <div key={item.id} className="border rounded-lg p-4">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-medium">{item.name}</h3>
                    <Badge variant={STATUS_VARIANTS[item.connectionStatus] || 'neutral'}>{item.connectionStatus.replace('_', ' ')}</Badge>
                  </div>
                  <p className="text-sm text-gray-500 mb-3">{item.description}</p>
                  {item.connectionStatus === 'not_connected' ? (
                    <Button size="sm">Connect</Button>
                  ) : (
                    <Button size="sm" variant="ghost">Manage</Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
