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
  const [activeTab, setActiveTab] = useState<'marketplace' | 'webhooks' | 'calendar'>('marketplace');

  useEffect(() => {
    integrationsApi.getMarketplace().then(setMarketplace).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const categories = [...new Set(marketplace.map((i: any) => i.category))];

  const tabs = [
    { key: 'marketplace' as const, label: 'Marketplace' },
    { key: 'webhooks' as const, label: 'Webhooks' },
    { key: 'calendar' as const, label: 'Calendar Feeds' },
  ];

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-6">Integrations</h1>

      <div className="border-b mb-6">
        <nav className="flex gap-4">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`pb-2 px-1 text-sm font-medium border-b-2 ${activeTab === t.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500'}`}>
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'marketplace' && (
        loading ? <div>Loading...</div> : (
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
                      <Button size="sm" onClick={() => integrationsApi.connectProvider(item.provider || item.name.toLowerCase(), window.location.origin + '/integrations').catch(() => alert('Connection failed'))}>Connect</Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm('Disconnect this integration?')) integrationsApi.disconnectIntegration(item.id).then(() => window.location.reload()).catch(() => alert('Disconnect failed')); }}>Manage</Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )
      )}

      {activeTab === 'webhooks' && <WebhooksSection />}
      {activeTab === 'calendar' && <CalendarFeedSection />}
    </div>
  );
}

function WebhooksSection() {
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [selectedWebhook, setSelectedWebhook] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { integrationsApi.getWebhooks().then(setWebhooks).catch(() => {}).finally(() => setLoading(false)); }, []);

  const handleViewDeliveries = async (id: string) => {
    if (selectedWebhook === id) { setSelectedWebhook(null); setDeliveries([]); return; }
    try {
      const data = await integrationsApi.getWebhookDeliveries(id);
      setDeliveries(data); setSelectedWebhook(id);
    } catch { alert('Could not load deliveries'); }
  };

  if (loading) return <div>Loading...</div>;
  return (
    <div>
      <h3 className="font-medium mb-4">Webhooks</h3>
      {webhooks.length === 0 ? <p className="text-gray-500">No webhooks configured</p> : (
        <div className="space-y-2">
          {webhooks.map((w: any) => (
            <div key={w.id}>
              <div className="border rounded p-3 flex justify-between items-center">
                <div>
                  <span className="font-medium">{w.url}</span>
                  <span className="text-xs text-gray-500 ml-2">{w.events?.join(', ') || 'all events'}</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => handleViewDeliveries(w.id)}>
                    {selectedWebhook === w.id ? 'Hide Deliveries' : 'Deliveries'}
                  </Button>
                  <Badge variant={w.active ? 'success' : 'neutral'}>{w.active ? 'Active' : 'Inactive'}</Badge>
                </div>
              </div>
              {selectedWebhook === w.id && (
                <div className="ml-4 mt-1 mb-2 border-l-2 pl-3 space-y-1">
                  {deliveries.length === 0 ? <p className="text-xs text-gray-500">No deliveries</p> : deliveries.slice(0, 20).map((d: any, i: number) => (
                    <div key={i} className="text-sm flex justify-between items-center">
                      <span>{d.event_type || d.event}</span>
                      <div className="flex gap-2 items-center">
                        <Badge variant={d.status_code >= 200 && d.status_code < 300 ? 'success' : 'error'}>{d.status_code}</Badge>
                        <span className="text-xs text-gray-400">{new Date(d.delivered_at || d.created_at).toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CalendarFeedSection() {
  const [staffFeed, setStaffFeed] = useState<any>(null);
  const [customerFeed, setCustomerFeed] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      integrationsApi.getStaffIcalFeed().catch(() => null),
      integrationsApi.getCustomerIcalFeed().catch(() => null),
    ]).then(([sf, cf]) => { setStaffFeed(sf); setCustomerFeed(cf); }).finally(() => setLoading(false));
  }, []);

  const handleRegenerate = async () => {
    if (!confirm('Regenerate iCal token? Existing feed URLs will stop working.')) return;
    try {
      const result = await integrationsApi.regenerateIcalToken();
      setCustomerFeed(result);
      alert('Token regenerated');
    } catch { alert('Regeneration failed'); }
  };

  if (loading) return <div>Loading...</div>;
  return (
    <div>
      <h3 className="font-medium mb-4">Calendar Feeds</h3>
      <div className="space-y-4">
        <div className="border rounded p-4">
          <h4 className="text-sm font-medium mb-2">Staff Calendar Feed</h4>
          {staffFeed ? (
            <div className="flex items-center gap-2">
              <code className="text-xs bg-gray-100 px-2 py-1 rounded flex-1 break-all">{staffFeed.url || staffFeed.feed_url}</code>
            </div>
          ) : <p className="text-sm text-gray-500">No staff feed available</p>}
        </div>
        <div className="border rounded p-4">
          <h4 className="text-sm font-medium mb-2">Customer Calendar Feed</h4>
          {customerFeed ? (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <code className="text-xs bg-gray-100 px-2 py-1 rounded flex-1 break-all">{customerFeed.url || customerFeed.feed_url}</code>
              </div>
              <Button size="sm" variant="ghost" onClick={handleRegenerate}>Regenerate Token</Button>
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-500 mb-2">No customer feed available</p>
              <Button size="sm" variant="ghost" onClick={handleRegenerate}>Generate Feed</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
