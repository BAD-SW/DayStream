import { useState, useEffect } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { Card } from '../design-system/components/data/Card';
import { ListRow, ListRows, ListRowTitle, ListRowMeta, ListEmpty } from '../design-system/components/data/ListRow';
import { PageHeader } from '../design-system/components/layout/PageHeader';
import { TabBar } from '../design-system/components/navigation/TabBar';
import * as integrationsApi from '../api/integrations';
import './Integrations.css';

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
    <div>
      <PageHeader title="Integrations" />
      <TabBar aria-label="Integration sections" tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {activeTab === 'marketplace' && (
        loading ? <ListEmpty>Loading...</ListEmpty> : (
          categories.map((cat) => (
            <section key={cat} className="int-category">
              <h2 className="int-section-title">{cat}</h2>
              <div className="int-grid">
                {marketplace.filter((i: any) => i.category === cat).map((item: any) => (
                  <Card key={item.id} variant="outlined" padding="lg">
                    <div className="int-card-head">
                      <h3 className="int-card-title">{item.name}</h3>
                      <Badge variant={STATUS_VARIANTS[item.connectionStatus] || 'neutral'}>{item.connectionStatus.replace('_', ' ')}</Badge>
                    </div>
                    <p className="int-muted">{item.description}</p>
                    {item.connectionStatus === 'not_connected' ? (
                      <Button size="sm" onClick={() => integrationsApi.connectProvider(item.provider || item.name.toLowerCase(), window.location.origin + '/integrations').catch(() => alert('Connection failed'))}>Connect</Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm('Disconnect this integration?')) integrationsApi.disconnectIntegration(item.id).then(() => window.location.reload()).catch(() => alert('Disconnect failed')); }}>Manage</Button>
                    )}
                  </Card>
                ))}
              </div>
            </section>
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

  if (loading) return <ListEmpty>Loading...</ListEmpty>;
  return (
    <div>
      <h3 className="int-section-title">Webhooks</h3>
      {webhooks.length === 0 ? <ListEmpty>No webhooks configured</ListEmpty> : (
        <ListRows>
          {webhooks.map((w: any) => (
            <div key={w.id}>
              <ListRow actions={<>
                <Button size="sm" variant="ghost" onClick={() => handleViewDeliveries(w.id)}>
                  {selectedWebhook === w.id ? 'Hide Deliveries' : 'Deliveries'}
                </Button>
                <Badge variant={w.active ? 'success' : 'neutral'}>{w.active ? 'Active' : 'Inactive'}</Badge>
              </>}>
                <ListRowTitle>{w.url}</ListRowTitle>
                <ListRowMeta>{w.events?.join(', ') || 'all events'}</ListRowMeta>
              </ListRow>
              {selectedWebhook === w.id && (
                <div className="int-sublist">
                  {deliveries.length === 0 ? <p className="int-muted">No deliveries</p> : deliveries.slice(0, 20).map((d: any, i: number) => (
                    <div key={i} className="int-sublist__item">
                      <span>{d.event_type || d.event}</span>
                      <div className="int-inline">
                        <Badge variant={d.status_code >= 200 && d.status_code < 300 ? 'success' : 'error'}>{String(d.status_code)}</Badge>
                        <span className="int-muted">{new Date(d.delivered_at || d.created_at).toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </ListRows>
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

  if (loading) return <ListEmpty>Loading...</ListEmpty>;
  return (
    <div>
      <h3 className="int-section-title">Calendar Feeds</h3>
      <div className="int-stack">
        <Card variant="outlined" padding="lg" title="Staff Calendar Feed">
          {staffFeed ? (
            <code className="int-code">{staffFeed.url || staffFeed.feed_url}</code>
          ) : <p className="int-muted">No staff feed available</p>}
        </Card>
        <Card variant="outlined" padding="lg" title="Customer Calendar Feed">
          {customerFeed ? (
            <div className="int-stack">
              <code className="int-code">{customerFeed.url || customerFeed.feed_url}</code>
              <div><Button size="sm" variant="ghost" onClick={handleRegenerate}>Regenerate Token</Button></div>
            </div>
          ) : (
            <div className="int-stack">
              <p className="int-muted">No customer feed available</p>
              <div><Button size="sm" variant="ghost" onClick={handleRegenerate}>Generate Feed</Button></div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
