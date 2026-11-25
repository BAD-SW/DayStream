import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import * as marketingApi from '../api/marketing';
import { formatDate, formatNumber } from '../utils/format';

export function CampaignDetail() {
  const { t } = useTranslation('marketing');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [confirmSend, setConfirmSend] = useState(false);
  const [sendError, setSendError] = useState('');

  useEffect(() => {
    if (!id) return;
    Promise.all([
      marketingApi.getCampaign(id),
      marketingApi.getCampaignAnalytics(id).catch(() => null),
    ]).then(([c, a]) => { setCampaign(c); setAnalytics(a); }).finally(() => setLoading(false));
  }, [id]);

  const handleSend = async () => {
    if (!id) return;
    setConfirmSend(false);
    setSendError('');
    try {
      await marketingApi.sendCampaign(id);
      setCampaign({ ...campaign, status: 'sent' });
    } catch (err: any) { setSendError(err.response?.data?.error || t('campaignDetail.sendFailed')); }
  };

  if (loading) return <div style={styles.page}><p>{t('common:loading')}</p></div>;
  if (!campaign) return <div style={styles.page}><p>{t('campaignDetail.notFound')}</p></div>;

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/marketing')}>{t('page.back')}</button>
      <div style={styles.header}>
        <h1 style={styles.title}>{campaign.name}</h1>
        <Badge variant={campaign.status === 'sent' ? 'success' : campaign.status === 'draft' ? 'neutral' : 'info'}>{t('status.' + campaign.status, { defaultValue: campaign.status })}</Badge>
      </div>

      <div style={styles.card}>
        <div style={styles.field}><span style={styles.label}>{t('campaign.channel')}</span><span style={styles.value}>{t('channel.' + campaign.channel, { defaultValue: campaign.channel })}</span></div>
        <div style={styles.field}><span style={styles.label}>{t('campaignDetail.subject')}</span><span style={styles.value}>{campaign.subject}</span></div>
        {campaign.created_at && <div style={styles.field}><span style={styles.label}>{t('campaignDetail.created')}</span><span style={styles.value}>{formatDate(campaign.created_at)}</span></div>}
      </div>

      {campaign.status === 'draft' && (
        <div style={styles.actions}>
          {confirmSend ? (
            <>
              <span style={styles.label}>{t('campaignDetail.sendConfirm')}</span>
              <Button variant="secondary" onClick={() => setConfirmSend(false)}>{t('common:cancel')}</Button>
              <Button onClick={handleSend}>{t('campaignDetail.send')}</Button>
            </>
          ) : (
            <Button onClick={() => setConfirmSend(true)}>{t('campaignDetail.sendNow')}</Button>
          )}
        </div>
      )}

      {sendError && <p role="alert" style={{ color: 'var(--color-error, #b42318)', fontSize: 'var(--font-size-sm)' }}>{sendError}</p>}

      {analytics && (
        <>
          <h2 style={{ ...styles.title, fontSize: 'var(--font-size-lg)', marginTop: 'var(--space-xl)' }}>{t('campaignDetail.analytics')}</h2>
          <div style={styles.card}>
            {Object.entries(analytics).map(([key, val]) => (
              <div key={key} style={styles.field}>
                <span style={styles.label}>{t('analytics.' + key, { defaultValue: key.replace(/_/g, ' ') })}</span>
                <span style={styles.value}>{typeof val === 'number' ? formatNumber(val) : String(val)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '800px', margin: '0 auto' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  header: { display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)', margin: 0 },
  card: { backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', padding: 'var(--space-lg)', display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)' },
  field: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', textTransform: 'capitalize' as const },
  value: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', fontWeight: 500 as any },
  actions: { display: 'flex', gap: 'var(--space-md)', marginTop: 'var(--space-lg)' },
};
