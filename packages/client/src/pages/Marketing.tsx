import { askText, showMessage } from '../design-system/components/feedback/dialogs';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { PageHeader } from '../design-system/components/layout/PageHeader';
import { TabBar } from '../design-system/components/navigation/TabBar';
import { StickyPageTop } from '../design-system/components/layout/StickyPageTop';
import { DraftSectionsProvider, DraftTab, useDraftSections } from '../components/unsaved/DraftSections';
import { LeaveGuard, useGuardedNavigate } from '../components/unsaved/LeaveGuard';
import { SaveChanges } from '../components/unsaved/SaveChanges';
import { ListRow, ListRows, ListRowTitle, ListRowMeta, ListEmpty } from '../design-system/components/data/ListRow';
import * as marketingApi from '../api/marketing';
import { Leads } from './Leads';
import './Marketing.css';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  draft: 'neutral', scheduled: 'info', sending: 'warning', sent: 'success', cancelled: 'error',
  active: 'success', paused: 'warning', archived: 'neutral',
};

type MarketingTab = 'leads' | 'campaigns' | 'sequences';

// Changes in the Leads rows wait for Save changes (David, 2026-11-02, decision 10); leaving asks first.
export function Marketing() {
  return (
    <DraftSectionsProvider>
      <MarketingPage />
    </DraftSectionsProvider>
  );
}

function MarketingPage() {
  const { t } = useTranslation('marketing');
  const navigate = useGuardedNavigate();
  const { dirtySections } = useDraftSections();
  const [searchParams, setSearchParams] = useSearchParams();
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [sequences, setSequences] = useState<any[]>([]);
  // Leads is the first section of Marketing (THE-17); the tab is kept in the address.
  const tabParam = searchParams.get('tab');
  const activeTab: MarketingTab = tabParam === 'campaigns' || tabParam === 'sequences' ? tabParam : 'leads';
  const setActiveTab = (tab: MarketingTab) => setSearchParams(tab === 'leads' ? {} : { tab }, { replace: true });
  const [selectedCampaign, setSelectedCampaign] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<any[]>([]);
  const [selectedSequence, setSelectedSequence] = useState<string | null>(null);
  const [enrollments, setEnrollments] = useState<any[]>([]);

  useEffect(() => {
    marketingApi.getCampaigns({ limit: 10 }).then((r) => setCampaigns(r.data)).catch(() => {});
    marketingApi.getSequences({ limit: 10 }).then((r) => setSequences(r.data)).catch(() => {});
  }, []);

  const handleSchedule = async (id: string) => {
    const scheduledAt = await askText({ message: t('page.schedulePrompt') });
    if (!scheduledAt) return;
    try {
      await marketingApi.scheduleCampaign(id, { scheduled_at: scheduledAt });
      setCampaigns(campaigns.map((c) => c.id === id ? { ...c, status: 'scheduled' } : c));
    } catch { void showMessage({ message: t('page.scheduleFailed'), tone: 'error' }); }
  };

  const handleTestSend = async (id: string) => {
    const email = await askText({ message: t('page.testEmailPrompt') });
    if (!email) return;
    try {
      await marketingApi.testCampaign(id, { email });
      void showMessage({ message: t('page.testSent'), tone: 'success' });
    } catch { void showMessage({ message: t('page.testFailed'), tone: 'error' }); }
  };

  const handleViewRecipients = async (id: string) => {
    if (selectedCampaign === id) { setSelectedCampaign(null); setRecipients([]); return; }
    try {
      const data = await marketingApi.getCampaignRecipients(id);
      setRecipients(data); setSelectedCampaign(id);
    } catch { void showMessage({ message: t('page.recipientsFailed'), tone: 'error' }); }
  };

  const handleViewEnrollments = async (id: string) => {
    if (selectedSequence === id) { setSelectedSequence(null); setEnrollments([]); return; }
    try {
      const data = await marketingApi.getSequenceEnrollments(id);
      setEnrollments(data); setSelectedSequence(id);
    } catch { void showMessage({ message: t('page.enrollmentsFailed'), tone: 'error' }); }
  };

  const tabs: { key: MarketingTab; label: string }[] = [
    { key: 'leads', label: t('page.tabLeads') }, { key: 'campaigns', label: t('page.tabCampaigns') }, { key: 'sequences', label: t('page.tabSequences') },
  ];

  return (
    <div className="mk-page">
      <LeaveGuard when={dirtySections.length > 0} />
      <StickyPageTop>
      <PageHeader
        title={t('page.title')}
        actions={<>
          <SaveChanges />
          <Button onClick={() => navigate('/marketing/campaigns/new')}>{t('page.newCampaign')}</Button>
          <Button variant="ghost" onClick={() => navigate('/marketing/sequences/new')}>{t('page.newSequence')}</Button>
        </>}
      />
      <TabBar aria-label={t('page.sections')} tabs={tabs.map((tb) => ({ ...tb, changed: dirtySections.some((s) => s.tab === tb.key) }))} active={activeTab} onChange={setActiveTab} />
      </StickyPageTop>

      {/* Leads stays mounted, so its unsaved changes survive switching tabs. */}
      <div hidden={activeTab !== 'leads'}><DraftTab tab="leads"><Leads /></DraftTab></div>

      {activeTab === 'campaigns' && (
        <ListRows>
          {campaigns.length === 0 ? <ListEmpty>{t('page.noCampaigns')}</ListEmpty> : campaigns.map((c: any) => (
            <div key={c.id}>
              <ListRow
                onClick={() => navigate(`/marketing/campaigns/${c.id}`)}
                actions={<>
                  {c.status === 'draft' && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => handleSchedule(c.id)}>{t('page.schedule')}</Button>
                      <Button size="sm" variant="ghost" onClick={() => handleTestSend(c.id)}>{t('page.test')}</Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => handleViewRecipients(c.id)}>
                    {selectedCampaign === c.id ? t('page.hideRecipients') : t('page.recipients')}
                  </Button>
                  <Badge variant={STATUS_VARIANTS[c.status] || 'neutral'}>{t('status.' + c.status, { defaultValue: c.status })}</Badge>
                </>}
              >
                <ListRowTitle>{c.name}</ListRowTitle>
                <ListRowMeta>{t('channel.' + c.channel, { defaultValue: c.channel })}</ListRowMeta>
              </ListRow>
              {selectedCampaign === c.id && recipients.length > 0 && (
                <div className="mk-sublist">
                  <p className="mk-sublist__count">{t('page.recipientCount', { count: recipients.length })}</p>
                  {recipients.slice(0, 10).map((r: any, i: number) => (
                    <div key={i} className="mk-sublist__item">{r.email || r.name || r.customer_id}</div>
                  ))}
                  {recipients.length > 10 && <p className="mk-sublist__count">{t('page.andMore', { count: recipients.length - 10 })}</p>}
                </div>
              )}
            </div>
          ))}
        </ListRows>
      )}

      {activeTab === 'sequences' && (
        <ListRows>
          {sequences.length === 0 ? <ListEmpty>{t('page.noSequences')}</ListEmpty> : sequences.map((s: any) => (
            <div key={s.id}>
              <ListRow
                onClick={() => navigate(`/marketing/sequences/${s.id}`)}
                actions={<>
                  <Button size="sm" variant="ghost" onClick={() => handleViewEnrollments(s.id)}>
                    {selectedSequence === s.id ? t('page.hideEnrollments') : t('page.enrollments')}
                  </Button>
                  <Badge variant={STATUS_VARIANTS[s.status] || 'neutral'}>{t('status.' + s.status, { defaultValue: s.status })}</Badge>
                </>}
              >
                <ListRowTitle>{s.name}</ListRowTitle>
                {s.is_template && <span className="mk-tag">{t('page.template')}</span>}
              </ListRow>
              {selectedSequence === s.id && enrollments.length > 0 && (
                <div className="mk-sublist">
                  <p className="mk-sublist__count">{t('page.enrollmentCount', { count: enrollments.length })}</p>
                  {enrollments.slice(0, 10).map((e: any, i: number) => (
                    <div key={i} className="mk-sublist__item mk-sublist__item--split">
                      <span>{e.customer_name || e.email || e.customer_id}</span>
                      <Badge variant={e.status === 'active' ? 'success' : 'neutral'}>{t('status.' + e.status, { defaultValue: e.status })}</Badge>
                    </div>
                  ))}
                  {enrollments.length > 10 && <p className="mk-sublist__count">{t('page.andMore', { count: enrollments.length - 10 })}</p>}
                </div>
              )}
            </div>
          ))}
        </ListRows>
      )}
    </div>
  );
}
