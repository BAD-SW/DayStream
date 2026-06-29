import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import * as marketingApi from '../api/marketing';

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

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Marketing</h1>
        <div className="flex gap-2">
          <Button onClick={() => navigate('/marketing/campaigns/new')}>New Campaign</Button>
          <Button variant="ghost" onClick={() => navigate('/marketing/sequences/new')}>New Sequence</Button>
        </div>
      </div>

      <div className="border-b mb-6">
        <nav className="flex gap-4">
          {(['campaigns', 'sequences'] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`pb-2 px-1 text-sm font-medium border-b-2 capitalize ${activeTab === tab ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500'}`}>
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'campaigns' && (
        <div className="space-y-2">
          {campaigns.length === 0 ? <p className="text-gray-500">No campaigns yet</p> : campaigns.map((c: any) => (
            <div key={c.id}>
              <div className="border rounded p-3 flex justify-between items-center cursor-pointer hover:border-blue-300"
                onClick={() => navigate(`/marketing/campaigns/${c.id}`)}>
                <div>
                  <span className="font-medium">{c.name}</span>
                  <span className="text-sm text-gray-500 ml-3">{c.channel}</span>
                </div>
                <div className="flex gap-2 items-center">
                  {c.status === 'draft' && (
                    <>
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); handleSchedule(c.id); }}>Schedule</Button>
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); handleTestSend(c.id); }}>Test</Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); handleViewRecipients(c.id); }}>
                    {selectedCampaign === c.id ? 'Hide Recipients' : 'Recipients'}
                  </Button>
                  <Badge variant={STATUS_VARIANTS[c.status] || 'neutral'}>{c.status}</Badge>
                </div>
              </div>
              {selectedCampaign === c.id && recipients.length > 0 && (
                <div className="ml-4 mt-1 mb-2 border-l-2 pl-3">
                  <p className="text-xs text-gray-500 mb-1">{recipients.length} recipients</p>
                  {recipients.slice(0, 10).map((r: any, i: number) => (
                    <div key={i} className="text-sm">{r.email || r.name || r.customer_id}</div>
                  ))}
                  {recipients.length > 10 && <p className="text-xs text-gray-400">...and {recipients.length - 10} more</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {activeTab === 'sequences' && (
        <div className="space-y-2">
          {sequences.length === 0 ? <p className="text-gray-500">No sequences yet</p> : sequences.map((s: any) => (
            <div key={s.id}>
              <div className="border rounded p-3 flex justify-between items-center cursor-pointer hover:border-blue-300"
                onClick={() => navigate(`/marketing/sequences/${s.id}`)}>
                <div>
                  <span className="font-medium">{s.name}</span>
                  {s.is_template && <span className="text-xs bg-purple-100 text-purple-700 ml-2 px-1 rounded">Template</span>}
                </div>
                <div className="flex gap-2 items-center">
                  <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); handleViewEnrollments(s.id); }}>
                    {selectedSequence === s.id ? 'Hide Enrollments' : 'Enrollments'}
                  </Button>
                  <Badge variant={STATUS_VARIANTS[s.status] || 'neutral'}>{s.status}</Badge>
                </div>
              </div>
              {selectedSequence === s.id && enrollments.length > 0 && (
                <div className="ml-4 mt-1 mb-2 border-l-2 pl-3">
                  <p className="text-xs text-gray-500 mb-1">{enrollments.length} enrollments</p>
                  {enrollments.slice(0, 10).map((e: any, i: number) => (
                    <div key={i} className="text-sm flex justify-between">
                      <span>{e.customer_name || e.email || e.customer_id}</span>
                      <Badge variant={e.status === 'active' ? 'success' : 'neutral'}>{e.status}</Badge>
                    </div>
                  ))}
                  {enrollments.length > 10 && <p className="text-xs text-gray-400">...and {enrollments.length - 10} more</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
