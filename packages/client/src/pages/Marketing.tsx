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

  useEffect(() => {
    marketingApi.getCampaigns({ limit: 10 }).then((r) => setCampaigns(r.data)).catch(() => {});
    marketingApi.getSequences({ limit: 10 }).then((r) => setSequences(r.data)).catch(() => {});
  }, []);

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
            <div key={c.id} className="border rounded p-3 flex justify-between items-center cursor-pointer hover:border-blue-300"
              onClick={() => navigate(`/marketing/campaigns/${c.id}`)}>
              <div>
                <span className="font-medium">{c.name}</span>
                <span className="text-sm text-gray-500 ml-3">{c.channel}</span>
              </div>
              <Badge variant={STATUS_VARIANTS[c.status] || 'neutral'}>{c.status}</Badge>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'sequences' && (
        <div className="space-y-2">
          {sequences.length === 0 ? <p className="text-gray-500">No sequences yet</p> : sequences.map((s: any) => (
            <div key={s.id} className="border rounded p-3 flex justify-between items-center cursor-pointer hover:border-blue-300"
              onClick={() => navigate(`/marketing/sequences/${s.id}`)}>
              <div>
                <span className="font-medium">{s.name}</span>
                {s.is_template && <span className="text-xs bg-purple-100 text-purple-700 ml-2 px-1 rounded">Template</span>}
              </div>
              <Badge variant={STATUS_VARIANTS[s.status] || 'neutral'}>{s.status}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
