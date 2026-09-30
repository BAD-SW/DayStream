import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { PageHeader } from '../design-system/components/layout/PageHeader';
import { TabBar } from '../design-system/components/navigation/TabBar';
import { ListRow, ListRows, ListRowTitle, ListRowMeta, ListEmpty } from '../design-system/components/data/ListRow';
import * as marketingApi from '../api/marketing';
import './Marketing.css';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  draft: 'neutral', scheduled: 'info', sending: 'warning', sent: 'success', cancelled: 'error',
  active: 'success', paused: 'warning', archived: 'neutral',
};

export function Marketing() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [sequences, setSequences] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'campaigns' | 'sequences'>('campaigns');
  const [selectedCampaign, setSelectedCampaign] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<any[]>([]);
  const [selectedSequence, setSelectedSequence] = useState<string | null>(null);
  const [enrollments, setEnrollments] = useState<any[]>([]);

  useEffect(() => {
    marketingApi.getCampaigns({ limit: 10 }).then((r) => setCampaigns(r.data)).catch(() => {});
    marketingApi.getSequences({ limit: 10 }).then((r) => setSequences(r.data)).catch(() => {});
  }, []);

  const handleSchedule = async (id: string) => {
    const scheduledAt = prompt('Enter schedule date (ISO format, e.g. 2025-01-15T10:00:00Z):');
    if (!scheduledAt) return;
    try {
      await marketingApi.scheduleCampaign(id, { scheduled_at: scheduledAt });
      setCampaigns(campaigns.map((c) => c.id === id ? { ...c, status: 'scheduled' } : c));
    } catch { alert('Schedule failed'); }
  };

  const handleTestSend = async (id: string) => {
    const email = prompt('Enter test email address:');
    if (!email) return;
    try {
      await marketingApi.testCampaign(id, { email });
      alert('Test sent');
    } catch { alert('Test send failed'); }
  };

  const handleViewRecipients = async (id: string) => {
    if (selectedCampaign === id) { setSelectedCampaign(null); setRecipients([]); return; }
    try {
      const data = await marketingApi.getCampaignRecipients(id);
      setRecipients(data); setSelectedCampaign(id);
    } catch { alert('Could not load recipients'); }
  };

  const handleViewEnrollments = async (id: string) => {
    if (selectedSequence === id) { setSelectedSequence(null); setEnrollments([]); return; }
    try {
      const data = await marketingApi.getSequenceEnrollments(id);
      setEnrollments(data); setSelectedSequence(id);
    } catch { alert('Could not load enrollments'); }
  };

  const tabs = [{ key: 'campaigns' as const, label: 'Campaigns' }, { key: 'sequences' as const, label: 'Sequences' }];

  return (
    <div className="mk-page">
      <PageHeader
        title="Marketing"
        actions={<>
          <Button onClick={() => navigate('/marketing/campaigns/new')}>New Campaign</Button>
          <Button variant="ghost" onClick={() => navigate('/marketing/sequences/new')}>New Sequence</Button>
        </>}
      />
      <TabBar aria-label="Marketing sections" tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {activeTab === 'campaigns' && (
        <ListRows>
          {campaigns.length === 0 ? <ListEmpty>No campaigns yet</ListEmpty> : campaigns.map((c: any) => (
            <div key={c.id}>
              <ListRow
                onClick={() => navigate(`/marketing/campaigns/${c.id}`)}
                actions={<>
                  {c.status === 'draft' && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => handleSchedule(c.id)}>Schedule</Button>
                      <Button size="sm" variant="ghost" onClick={() => handleTestSend(c.id)}>Test</Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => handleViewRecipients(c.id)}>
                    {selectedCampaign === c.id ? 'Hide Recipients' : 'Recipients'}
                  </Button>
                  <Badge variant={STATUS_VARIANTS[c.status] || 'neutral'}>{c.status}</Badge>
                </>}
              >
                <ListRowTitle>{c.name}</ListRowTitle>
                <ListRowMeta>{c.channel}</ListRowMeta>
              </ListRow>
              {selectedCampaign === c.id && recipients.length > 0 && (
                <div className="mk-sublist">
                  <p className="mk-sublist__count">{recipients.length} recipients</p>
                  {recipients.slice(0, 10).map((r: any, i: number) => (
                    <div key={i} className="mk-sublist__item">{r.email || r.name || r.customer_id}</div>
                  ))}
                  {recipients.length > 10 && <p className="mk-sublist__count">...and {recipients.length - 10} more</p>}
                </div>
              )}
            </div>
          ))}
        </ListRows>
      )}

      {activeTab === 'sequences' && (
        <ListRows>
          {sequences.length === 0 ? <ListEmpty>No sequences yet</ListEmpty> : sequences.map((s: any) => (
            <div key={s.id}>
              <ListRow
                onClick={() => navigate(`/marketing/sequences/${s.id}`)}
                actions={<>
                  <Button size="sm" variant="ghost" onClick={() => handleViewEnrollments(s.id)}>
                    {selectedSequence === s.id ? 'Hide Enrollments' : 'Enrollments'}
                  </Button>
                  <Badge variant={STATUS_VARIANTS[s.status] || 'neutral'}>{s.status}</Badge>
                </>}
              >
                <ListRowTitle>{s.name}</ListRowTitle>
                {s.is_template && <span className="mk-tag">Template</span>}
              </ListRow>
              {selectedSequence === s.id && enrollments.length > 0 && (
                <div className="mk-sublist">
                  <p className="mk-sublist__count">{enrollments.length} enrollments</p>
                  {enrollments.slice(0, 10).map((e: any, i: number) => (
                    <div key={i} className="mk-sublist__item mk-sublist__item--split">
                      <span>{e.customer_name || e.email || e.customer_id}</span>
                      <Badge variant={e.status === 'active' ? 'success' : 'neutral'}>{e.status}</Badge>
                    </div>
                  ))}
                  {enrollments.length > 10 && <p className="mk-sublist__count">...and {enrollments.length - 10} more</p>}
                </div>
              )}
            </div>
          ))}
        </ListRows>
      )}
    </div>
  );
}
