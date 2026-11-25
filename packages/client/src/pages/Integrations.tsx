import { askConfirm, showMessage } from '../design-system/components/feedback/dialogs';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { Card } from '../design-system/components/data/Card';
import { ListRow, ListRows, ListRowTitle, ListRowMeta, ListEmpty } from '../design-system/components/data/ListRow';
import { PageHeader } from '../design-system/components/layout/PageHeader';
import { TabBar } from '../design-system/components/navigation/TabBar';
import * as integrationsApi from '../api/integrations';
import { formatDateTime } from '../utils/format';
import './Integrations.css';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
  connected: 'success', disconnected: 'neutral', error: 'error', expired: 'warning', not_connected: 'neutral',
};

// Stored connection statuses, shown through payments:integrations.status.<value>.
const STATUS_KEYS = ['connected', 'disconnected', 'error', 'expired', 'not_connected'];

export function Integrations() {
  const { t } = useTranslation('payments');
  const [marketplace, setMarketplace] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'marketplace' | 'webhooks' | 'calendar'>('marketplace');

  useEffect(() => {
    integrationsApi.getMarketplace().then(setMarketplace).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const categories = [...new Set(marketplace.map((i: any) => i.category))];

  const tabs = [
    { key: 'marketplace' as const, label: t('integrations.tab.marketplace') },
    { key: 'webhooks' as const, label: t('integrations.tab.webhooks') },
    { key: 'calendar' as const, label: t('integrations.tab.calendar') },
  ];

  return (
    <div>
      <PageHeader title={t('integrations.title')} />
      <TabBar aria-label={t('integrations.tabsLabel')} tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {activeTab === 'marketplace' && (
        loading ? <ListEmpty>{t('common:loading')}</ListEmpty> : (
          categories.map((cat) => (
            <section key={cat} className="int-category">
              <h2 className="int-section-title">{cat}</h2>
              <div className="int-grid">
                {marketplace.filter((i: any) => i.category === cat).map((item: any) => (
                  <Card key={item.id} variant="outlined" padding="lg">
                    <div className="int-card-head">
                      <h3 className="int-card-title">{item.name}</h3>
                      <Badge variant={STATUS_VARIANTS[item.connectionStatus] || 'neutral'}>{STATUS_KEYS.includes(item.connectionStatus) ? t(`integrations.status.${item.connectionStatus}`) : item.connectionStatus}</Badge>
                    </div>
                    <p className="int-muted">{item.description}</p>
                    {item.connectionStatus === 'not_connected' ? (
                      <Button size="sm" onClick={() => integrationsApi.connectProvider(item.provider || item.name.toLowerCase(), window.location.origin + '/integrations').catch(() => void showMessage({ message: t('integrations.connectFailed'), tone: 'error' }))}>{t('integrations.connect')}</Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={async () => { if (await askConfirm({ message: t('integrations.disconnectConfirm'), confirmLabel: t('common:action.remove'), destructive: true })) integrationsApi.disconnectIntegration(item.id).then(() => window.location.reload()).catch(() => void showMessage({ message: t('integrations.disconnectFailed'), tone: 'error' })); }}>{t('integrations.manage')}</Button>
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
  const { t } = useTranslation('payments');
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
    } catch { void showMessage({ message: t('integrations.webhooks.loadFailed'), tone: 'error' }); }
  };

  if (loading) return <ListEmpty>{t('common:loading')}</ListEmpty>;
  return (
    <div>
      <h3 className="int-section-title">{t('integrations.tab.webhooks')}</h3>
      {webhooks.length === 0 ? <ListEmpty>{t('integrations.webhooks.empty')}</ListEmpty> : (
        <ListRows>
          {webhooks.map((w: any) => (
            <div key={w.id}>
              <ListRow actions={<>
                <Button size="sm" variant="ghost" onClick={() => handleViewDeliveries(w.id)}>
                  {selectedWebhook === w.id ? t('integrations.webhooks.hideDeliveries') : t('integrations.webhooks.deliveries')}
                </Button>
                <Badge variant={w.active ? 'success' : 'neutral'}>{w.active ? t('integrations.webhooks.active') : t('integrations.webhooks.inactive')}</Badge>
              </>}>
                <ListRowTitle>{w.url}</ListRowTitle>
                <ListRowMeta>{w.events?.join(', ') || t('integrations.webhooks.allEvents')}</ListRowMeta>
              </ListRow>
              {selectedWebhook === w.id && (
                <div className="int-sublist">
                  {deliveries.length === 0 ? <p className="int-muted">{t('integrations.webhooks.noDeliveries')}</p> : deliveries.slice(0, 20).map((d: any, i: number) => (
                    <div key={i} className="int-sublist__item">
                      <span>{d.event_type || d.event}</span>
                      <div className="int-inline">
                        <Badge variant={d.status_code >= 200 && d.status_code < 300 ? 'success' : 'error'}>{String(d.status_code)}</Badge>
                        <span className="int-muted">{formatDateTime(d.delivered_at || d.created_at)}</span>
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
  const { t } = useTranslation('payments');
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
    if (!(await askConfirm({ message: t('integrations.calendar.regenerateConfirm'), confirmLabel: t('common:action.regenerate') }))) return;
    try {
      const result = await integrationsApi.regenerateIcalToken();
      setCustomerFeed(result);
      void showMessage({ message: t('integrations.calendar.regenerated'), tone: 'success' });
    } catch { void showMessage({ message: t('integrations.calendar.regenerateFailed'), tone: 'error' }); }
  };

  if (loading) return <ListEmpty>{t('common:loading')}</ListEmpty>;
  return (
    <div>
      <h3 className="int-section-title">{t('integrations.tab.calendar')}</h3>
      <div className="int-stack">
        <Card variant="outlined" padding="lg" title={t('integrations.calendar.staffFeed')}>
          {staffFeed ? (
            <code className="int-code">{staffFeed.url || staffFeed.feed_url}</code>
          ) : <p className="int-muted">{t('integrations.calendar.noStaffFeed')}</p>}
        </Card>
        <Card variant="outlined" padding="lg" title={t('integrations.calendar.customerFeed')}>
          {customerFeed ? (
            <div className="int-stack">
              <code className="int-code">{customerFeed.url || customerFeed.feed_url}</code>
              <div><Button size="sm" variant="ghost" onClick={handleRegenerate}>{t('integrations.calendar.regenerate')}</Button></div>
            </div>
          ) : (
            <div className="int-stack">
              <p className="int-muted">{t('integrations.calendar.noCustomerFeed')}</p>
              <div><Button size="sm" variant="ghost" onClick={handleRegenerate}>{t('integrations.calendar.generate')}</Button></div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
