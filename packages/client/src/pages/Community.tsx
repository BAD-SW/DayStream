import { askText, showMessage } from '../design-system/components/feedback/dialogs';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { Card } from '../design-system/components/data/Card';
import { ListRow, ListRows, ListRowTitle, ListEmpty } from '../design-system/components/data/ListRow';
import { SegmentedControl } from '../design-system/components/forms/SegmentedControl';
import { PageHeader } from '../design-system/components/layout/PageHeader';
import { TabBar } from '../design-system/components/navigation/TabBar';
import * as communityApi from '../api/community';
import { formatDate } from '../utils/format';
import './Community.css';

export function Community() {
  const { t } = useTranslation('portal');
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
    { key: 'feed' as const, label: t('community.tab.feed') },
    { key: 'challenges' as const, label: t('community.tab.challenges') },
    { key: 'leaderboard' as const, label: t('community.tab.leaderboard') },
    { key: 'content' as const, label: t('community.tab.content') },
    { key: 'reviews' as const, label: t('community.tab.reviews') },
  ];

  return (
    <div>
      <PageHeader title={t('community.title')} />
      <TabBar aria-label={t('community.sections')} tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {activeTab === 'feed' && (
        <div className="cm-stack">
          {feed.length === 0 ? <ListEmpty>{t('community.noPosts')}</ListEmpty> : feed.map((p: any) => (
            <Card key={p.id} variant="outlined">
              <div className="cm-head">
                <Badge variant={p.post_type === 'achievement' ? 'success' : 'neutral'}>{t(`community.postType.${p.post_type}`, { defaultValue: String(p.post_type).replace('_', ' ') })}</Badge>
                <span className="cm-muted">{formatDate(p.created_at)}</span>
              </div>
              {p.content && <p className="cm-text">{p.content}</p>}
              <div className="cm-reactions">
                <span>❤️ {p.reaction_count}</span>
                <span>💬 {p.comment_count}</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {activeTab === 'challenges' && <ChallengesTab challenges={challenges} />}

      {activeTab === 'leaderboard' && (
        <ListRows>
          {leaderboard.map((entry: any, i: number) => (
            <ListRow key={entry.customer_id} actions={<span className="cm-points">{t('community.points', { n: entry.total_points })}</span>}>
              <ListRowTitle>#{i + 1}</ListRowTitle>
              <span>{entry.customer_id.slice(0, 8)}...</span>
            </ListRow>
          ))}
          {leaderboard.length === 0 && <ListEmpty>{t('community.noData')}</ListEmpty>}
        </ListRows>
      )}

      {activeTab === 'content' && <ContentTab />}
      {activeTab === 'reviews' && <ReviewsTab />}
    </div>
  );
}

function ChallengesTab({ challenges }: { challenges: any[] }) {
  const { t } = useTranslation('portal');
  const [selectedChallenge, setSelectedChallenge] = useState<string | null>(null);
  const [challengeLeaderboard, setChallengeLeaderboard] = useState<any[]>([]);

  const handleViewLeaderboard = async (id: string) => {
    if (selectedChallenge === id) { setSelectedChallenge(null); setChallengeLeaderboard([]); return; }
    try {
      const data = await communityApi.getChallengeLeaderboard(id);
      setChallengeLeaderboard(data); setSelectedChallenge(id);
    } catch { void showMessage({ message: t('community.leaderboardFailed'), tone: 'error' }); }
  };

  return (
    <div className="cm-stack">
      {challenges.length === 0 ? <ListEmpty>{t('community.noChallenges')}</ListEmpty> : challenges.map((c: any) => (
        <div key={c.id}>
          <Card variant="outlined">
            <h3 className="cm-title">{c.title}</h3>
            <p className="cm-muted">{c.description}</p>
            <div className="cm-foot">
              <span className="cm-muted">{c.start_date} → {c.end_date}</span>
              <div className="cm-actions">
                <Button size="sm" variant="ghost" onClick={() => handleViewLeaderboard(c.id)}>
                  {selectedChallenge === c.id ? t('community.hideLeaderboard') : t('community.tab.leaderboard')}
                </Button>
                <Button size="sm" onClick={() => communityApi.joinChallenge(c.id).then(() => void showMessage({ message: t('community.joined'), tone: 'success' })).catch(() => void showMessage({ message: t('community.joinFailed'), tone: 'error' }))}>{t('community.join')}</Button>
              </div>
            </div>
          </Card>
          {selectedChallenge === c.id && challengeLeaderboard.length > 0 && (
            <div className="cm-sublist">
              {challengeLeaderboard.map((entry: any, i: number) => (
                <div key={i} className="cm-sublist__item">
                  <span>#{i + 1} {entry.customer_name || entry.customer_id?.slice(0, 8)}</span>
                  <span className="cm-points">{t('community.points', { n: entry.score || entry.progress })}</span>
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
  const { t } = useTranslation('portal');
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
    } catch { void showMessage({ message: t('community.videoFailed'), tone: 'error' }); }
  };

  const handleUpdateProgress = async (vodId: string, progress: number) => {
    try {
      await communityApi.updateVodProgress(vodId, { progress_percent: progress });
      void showMessage({ message: t('community.progressUpdated'), tone: 'success' });
    } catch { void showMessage({ message: t('community.progressFailed'), tone: 'error' }); }
  };

  const handleCompleteLesson = async (courseId: string, lessonId: string) => {
    try {
      await communityApi.completeLesson(courseId, lessonId);
      void showMessage({ message: t('community.lessonCompleted'), tone: 'success' });
    } catch { void showMessage({ message: t('community.lessonFailed'), tone: 'error' }); }
  };

  return (
    <div>
      <div className="cm-toolbar">
        <SegmentedControl
          aria-label={t('community.contentType')}
          value={view}
          onChange={setView}
          options={[{ value: 'vod', label: t('community.videos') }, { value: 'courses', label: t('community.courses') }]}
        />
      </div>

      {view === 'vod' && (
        <div className="cm-stack">
          {vodLibrary.length === 0 ? <ListEmpty>{t('community.noVideos')}</ListEmpty> : vodLibrary.map((v: any) => (
            <Card key={v.id} variant="outlined">
              <div className="cm-head">
                <div>
                  <span className="cm-title">{v.title}</span>
                  {v.duration && <span className="cm-muted cm-inline">{v.duration}</span>}
                </div>
                <div className="cm-actions">
                  <Button size="sm" variant="ghost" onClick={() => handleVodDetail(v.id)}>{t('community.details')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => handleUpdateProgress(v.id, 100)}>{t('community.markComplete')}</Button>
                </div>
              </div>
              {selectedVod?.id === v.id && (
                <div className="cm-detail">
                  <p>{selectedVod.description || t('community.noDescription')}</p>
                  {selectedVod.progress_percent !== undefined && <p className="cm-muted">{t('community.progress', { n: selectedVod.progress_percent })}</p>}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {view === 'courses' && (
        <div className="cm-stack">
          {courses.length === 0 ? <ListEmpty>{t('community.noCourses')}</ListEmpty> : courses.map((c: any) => (
            <Card key={c.id} variant="outlined">
              <h4 className="cm-title">{c.title}</h4>
              <p className="cm-muted">{c.description}</p>
              {c.lessons && c.lessons.length > 0 && (
                <div className="cm-sublist">
                  {c.lessons.map((l: any) => (
                    <div key={l.id} className="cm-sublist__item">
                      <span>{l.title}</span>
                      <Button size="sm" variant="ghost" onClick={() => handleCompleteLesson(c.id, l.id)}>{t('community.complete')}</Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewsTab() {
  const { t } = useTranslation('portal');
  const [serviceId, setServiceId] = useState('');
  const [reviews, setReviews] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);

  const loadReviews = async () => {
    if (!serviceId) return;
    try {
      const data = await communityApi.getReviewsByService(serviceId);
      setReviews(data); setLoaded(true);
    } catch { void showMessage({ message: t('community.reviewsFailed'), tone: 'error' }); }
  };

  const handleModerate = async (reviewId: string, action: string) => {
    try {
      await communityApi.moderateReview(reviewId, { action });
      setReviews(reviews.map((r) => r.id === reviewId ? { ...r, moderation_status: action } : r));
    } catch { void showMessage({ message: t('community.moderationFailed'), tone: 'error' }); }
  };

  const handleRespond = async (reviewId: string) => {
    const response = await askText({ message: t('community.enterResponse') });
    if (!response) return;
    try {
      await communityApi.respondToReview(reviewId, { response });
      setReviews(reviews.map((r) => r.id === reviewId ? { ...r, response } : r));
    } catch { void showMessage({ message: t('community.responseFailed'), tone: 'error' }); }
  };

  return (
    <div>
      <div className="cm-toolbar">
        <input className="cm-input" aria-label={t('community.serviceId')} placeholder={t('community.serviceId')} value={serviceId} onChange={(e) => setServiceId(e.target.value)} />
        <Button size="sm" onClick={loadReviews}>{t('community.loadReviews')}</Button>
      </div>
      {loaded && (
        <div className="cm-stack">
          {reviews.length === 0 ? <ListEmpty>{t('community.noReviews')}</ListEmpty> : reviews.map((r: any) => (
            <Card key={r.id} variant="outlined">
              <div className="cm-head">
                <div>
                  <span className="cm-title">{r.customer_name || t('community.anonymous')}</span>
                  <span className="cm-stars" aria-label={t('community.stars', { n: r.rating || 0 })}>{'★'.repeat(r.rating || 0)}{'☆'.repeat(5 - (r.rating || 0))}</span>
                </div>
                <Badge variant={r.moderation_status === 'approved' ? 'success' : r.moderation_status === 'rejected' ? 'error' : 'neutral'}>
                  {t(`community.moderation.${r.moderation_status || 'pending'}`, { defaultValue: String(r.moderation_status) })}
                </Badge>
              </div>
              {r.content && <p className="cm-text">{r.content}</p>}
              {r.response && <p className="cm-text cm-response">{t('community.response', { text: r.response })}</p>}
              <div className="cm-actions cm-actions--below">
                <Button size="sm" variant="ghost" onClick={() => handleModerate(r.id, 'approved')}>{t('community.approve')}</Button>
                <Button size="sm" variant="ghost" onClick={() => handleModerate(r.id, 'rejected')}>{t('community.reject')}</Button>
                <Button size="sm" variant="ghost" onClick={() => handleRespond(r.id)}>{t('community.respond')}</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
