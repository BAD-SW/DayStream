import { useState, useEffect } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import * as communityApi from '../api/community';

export function Community() {
  const [activeTab, setActiveTab] = useState<'feed' | 'challenges' | 'leaderboard' | 'content'>('feed');
  const [feed, setFeed] = useState<any[]>([]);
  const [challenges, setChallenges] = useState<any[]>([]);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);

  useEffect(() => {
    communityApi.getFeed().then(setFeed).catch(() => {});
    communityApi.getChallenges('active').then(setChallenges).catch(() => {});
    communityApi.getLeaderboard('points').then(setLeaderboard).catch(() => {});
  }, []);

  const tabs = [
    { key: 'feed' as const, label: 'Feed' },
    { key: 'challenges' as const, label: 'Challenges' },
    { key: 'leaderboard' as const, label: 'Leaderboard' },
    { key: 'content' as const, label: 'Content' },
  ];

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-6">Community</h1>
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

      {activeTab === 'feed' && (
        <div className="space-y-4">
          {feed.length === 0 ? <p className="text-gray-500">No posts yet</p> : feed.map((p: any) => (
            <div key={p.id} className="border rounded-lg p-4">
              <div className="flex justify-between items-start mb-2">
                <Badge variant={p.post_type === 'achievement' ? 'success' : 'neutral'}>{p.post_type}</Badge>
                <span className="text-xs text-gray-400">{new Date(p.created_at).toLocaleDateString()}</span>
              </div>
              {p.content && <p className="text-sm">{p.content}</p>}
              <div className="flex gap-4 mt-2 text-xs text-gray-500">
                <span>❤️ {p.reaction_count}</span>
                <span>💬 {p.comment_count}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'challenges' && (
        <div className="space-y-3">
          {challenges.length === 0 ? <p className="text-gray-500">No active challenges</p> : challenges.map((c: any) => (
            <div key={c.id} className="border rounded-lg p-4">
              <h3 className="font-medium">{c.title}</h3>
              <p className="text-sm text-gray-500">{c.description}</p>
              <div className="flex justify-between items-center mt-2">
                <span className="text-xs text-gray-400">{c.start_date} → {c.end_date}</span>
                <Button size="sm">Join</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'leaderboard' && (
        <div className="space-y-2">
          {leaderboard.map((entry: any, i: number) => (
            <div key={entry.customer_id} className="border rounded p-3 flex justify-between items-center">
              <span className="font-medium">#{i + 1}</span>
              <span>{entry.customer_id.slice(0, 8)}...</span>
              <span className="font-bold">{entry.total_points} pts</span>
            </div>
          ))}
          {leaderboard.length === 0 && <p className="text-gray-500">No data yet</p>}
        </div>
      )}

      {activeTab === 'content' && (
        <div className="text-gray-500">
          <p>Video library and courses will appear here.</p>
        </div>
      )}
    </div>
  );
}
