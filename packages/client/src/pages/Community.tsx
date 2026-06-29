import { useState, useEffect } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import * as communityApi from '../api/community';

export function Community() {
  const [activeTab, setActiveTab] = useState<'feed' | 'challenges' | 'leaderboard' | 'content' | 'reviews'>('feed');
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
    { key: 'reviews' as const, label: 'Reviews' },
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

      {activeTab === 'challenges' && <ChallengesTab challenges={challenges} />}

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

      {activeTab === 'content' && <ContentTab />}
      {activeTab === 'reviews' && <ReviewsTab />}
    </div>
  );
}

function ChallengesTab({ challenges }: { challenges: any[] }) {
  const [selectedChallenge, setSelectedChallenge] = useState<string | null>(null);
  const [challengeLeaderboard, setChallengeLeaderboard] = useState<any[]>([]);

  const handleViewLeaderboard = async (id: string) => {
    if (selectedChallenge === id) { setSelectedChallenge(null); setChallengeLeaderboard([]); return; }
    try {
      const data = await communityApi.getChallengeLeaderboard(id);
      setChallengeLeaderboard(data); setSelectedChallenge(id);
    } catch { alert('Could not load leaderboard'); }
  };

  return (
    <div className="space-y-3">
      {challenges.length === 0 ? <p className="text-gray-500">No active challenges</p> : challenges.map((c: any) => (
        <div key={c.id}>
          <div className="border rounded-lg p-4">
            <h3 className="font-medium">{c.title}</h3>
            <p className="text-sm text-gray-500">{c.description}</p>
            <div className="flex justify-between items-center mt-2">
              <span className="text-xs text-gray-400">{c.start_date} → {c.end_date}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => handleViewLeaderboard(c.id)}>
                  {selectedChallenge === c.id ? 'Hide Leaderboard' : 'Leaderboard'}
                </Button>
                <Button size="sm">Join</Button>
              </div>
            </div>
          </div>
          {selectedChallenge === c.id && challengeLeaderboard.length > 0 && (
            <div className="ml-4 mt-1 mb-2 border-l-2 pl-3 space-y-1">
              {challengeLeaderboard.map((entry: any, i: number) => (
                <div key={i} className="text-sm flex justify-between">
                  <span>#{i + 1} {entry.customer_name || entry.customer_id?.slice(0, 8)}</span>
                  <span className="font-medium">{entry.score || entry.progress} pts</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ContentTab() {
  const [vodLibrary, setVodLibrary] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [selectedVod, setSelectedVod] = useState<any>(null);
  const [view, setView] = useState<'vod' | 'courses'>('vod');

  useEffect(() => {
    communityApi.getVodLibrary().then(setVodLibrary).catch(() => {});
    communityApi.getCourses().then(setCourses).catch(() => {});
  }, []);

  const handleVodDetail = async (id: string) => {
    try {
      const data = await communityApi.getVodDetail(id);
      setSelectedVod(data);
    } catch { alert('Could not load video details'); }
  };

  const handleUpdateProgress = async (vodId: string, progress: number) => {
    try {
      await communityApi.updateVodProgress(vodId, { progress_percent: progress });
      alert('Progress updated');
    } catch { alert('Could not update progress'); }
  };

  const handleCompleteLesson = async (courseId: string, lessonId: string) => {
    try {
      await communityApi.completeLesson(courseId, lessonId);
      alert('Lesson completed');
    } catch { alert('Could not complete lesson'); }
  };

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <Button size="sm" variant={view === 'vod' ? 'default' : 'ghost'} onClick={() => setView('vod')}>Videos</Button>
        <Button size="sm" variant={view === 'courses' ? 'default' : 'ghost'} onClick={() => setView('courses')}>Courses</Button>
      </div>

      {view === 'vod' && (
        <div className="space-y-2">
          {vodLibrary.length === 0 ? <p className="text-gray-500">No videos available</p> : vodLibrary.map((v: any) => (
            <div key={v.id} className="border rounded p-3">
              <div className="flex justify-between items-center">
                <div>
                  <span className="font-medium">{v.title}</span>
                  {v.duration && <span className="text-xs text-gray-500 ml-2">{v.duration}</span>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => handleVodDetail(v.id)}>Details</Button>
                  <Button size="sm" variant="ghost" onClick={() => handleUpdateProgress(v.id, 100)}>Mark Complete</Button>
                </div>
              </div>
              {selectedVod?.id === v.id && (
                <div className="mt-2 p-2 bg-gray-50 rounded text-sm">
                  <p>{selectedVod.description || 'No description'}</p>
                  {selectedVod.progress_percent !== undefined && <p className="text-xs text-gray-500 mt-1">Progress: {selectedVod.progress_percent}%</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {view === 'courses' && (
        <div className="space-y-2">
          {courses.length === 0 ? <p className="text-gray-500">No courses available</p> : courses.map((c: any) => (
            <div key={c.id} className="border rounded p-3">
              <h4 className="font-medium">{c.title}</h4>
              <p className="text-sm text-gray-500">{c.description}</p>
              {c.lessons && c.lessons.length > 0 && (
                <div className="mt-2 space-y-1">
                  {c.lessons.map((l: any) => (
                    <div key={l.id} className="flex justify-between items-center text-sm pl-2 border-l">
                      <span>{l.title}</span>
                      <Button size="sm" variant="ghost" onClick={() => handleCompleteLesson(c.id, l.id)}>Complete</Button>
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

function ReviewsTab() {
  const [serviceId, setServiceId] = useState('');
  const [reviews, setReviews] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);

  const loadReviews = async () => {
    if (!serviceId) return;
    try {
      const data = await communityApi.getReviewsByService(serviceId);
      setReviews(data); setLoaded(true);
    } catch { alert('Could not load reviews'); }
  };

  const handleModerate = async (reviewId: string, action: string) => {
    try {
      await communityApi.moderateReview(reviewId, { action });
      setReviews(reviews.map((r) => r.id === reviewId ? { ...r, moderation_status: action } : r));
    } catch { alert('Moderation failed'); }
  };

  const handleRespond = async (reviewId: string) => {
    const response = prompt('Enter your response:');
    if (!response) return;
    try {
      await communityApi.respondToReview(reviewId, { response });
      setReviews(reviews.map((r) => r.id === reviewId ? { ...r, response } : r));
    } catch { alert('Response failed'); }
  };

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <input className="border rounded px-2 py-1 text-sm flex-1" placeholder="Service ID" value={serviceId} onChange={(e) => setServiceId(e.target.value)} />
        <Button size="sm" onClick={loadReviews}>Load Reviews</Button>
      </div>
      {loaded && (
        <div className="space-y-2">
          {reviews.length === 0 ? <p className="text-gray-500">No reviews for this service</p> : reviews.map((r: any) => (
            <div key={r.id} className="border rounded p-3">
              <div className="flex justify-between items-start">
                <div>
                  <span className="font-medium">{r.customer_name || 'Anonymous'}</span>
                  <span className="text-yellow-500 ml-2">{'★'.repeat(r.rating || 0)}{'☆'.repeat(5 - (r.rating || 0))}</span>
                </div>
                <Badge variant={r.moderation_status === 'approved' ? 'success' : r.moderation_status === 'rejected' ? 'error' : 'neutral'}>
                  {r.moderation_status || 'pending'}
                </Badge>
              </div>
              {r.content && <p className="text-sm mt-1">{r.content}</p>}
              {r.response && <p className="text-sm mt-1 text-blue-600 italic">Response: {r.response}</p>}
              <div className="flex gap-2 mt-2">
                <Button size="sm" variant="ghost" onClick={() => handleModerate(r.id, 'approved')}>Approve</Button>
                <Button size="sm" variant="ghost" onClick={() => handleModerate(r.id, 'rejected')}>Reject</Button>
                <Button size="sm" variant="ghost" onClick={() => handleRespond(r.id)}>Respond</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
