import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { PageHeader } from '../design-system/components/layout/PageHeader';
import { ListRow, ListRows, ListRowTitle, ListRowMeta, ListEmpty } from '../design-system/components/data/ListRow';
import * as cmsApi from '../api/cms';
import './CMS.css';

export function CMS() {
  const { t } = useTranslation('cms');
  const navigate = useNavigate();
  const [site, setSite] = useState<any>(null);
  const [pages, setPages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([cmsApi.getSite(), cmsApi.getPages()])
      .then(([s, p]) => { setSite(s); setPages(p); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="cms-muted">{t('common:loading')}</p>;

  return (
    <div>
      <PageHeader
        title={t('site.title')}
        actions={<>
          <Button onClick={() => cmsApi.publishSite().then(setSite)}>{t('site.publish')}</Button>
          <Button variant="ghost" onClick={() => navigate('/cms/blog')}>{t('site.blog')}</Button>
          <Button variant="ghost" onClick={() => navigate('/cms/media')}>{t('site.media')}</Button>
        </>}
      />

      {site && (
        <div className="cms-site">
          <div className="cms-site__row">
            <div className="cms-site__hosting">
              <span className="cms-muted">{t('site.hosting')}</span>
              <Badge variant={site.hosting_tier === 'custom_domain' ? 'success' : 'info'}>{t(`site.tier.${site.hosting_tier}`, { defaultValue: site.hosting_tier })}</Badge>
              {site.custom_domain && <span>{site.custom_domain}</span>}
            </div>
            <Badge variant={site.is_published ? 'success' : 'neutral'}>{site.is_published ? t('status.published') : t('status.draft')}</Badge>
          </div>
          <div className="cms-muted">
            <Trans t={t} i18nKey="site.subdomain" values={{ domain: `${site.slug}.daystream.app` }} components={{ code: <code /> }} />
          </div>
        </div>
      )}

      <h2 className="cms-section-title">{t('site.pages')}</h2>
      <ListRows>
        {pages.map((p: any) => (
          <ListRow
            key={p.id}
            onClick={() => navigate(`/cms/pages/${p.id}`)}
            actions={<>
              <Badge variant={p.is_enabled ? 'success' : 'neutral'}>{p.is_enabled ? t('site.enabled') : t('site.disabled')}</Badge>
              <Badge variant={p.status === 'published' ? 'success' : 'neutral'}>{t(`status.${p.status}`, { defaultValue: p.status })}</Badge>
            </>}
          >
            <ListRowTitle>{p.title}</ListRowTitle>
            <ListRowMeta>/{p.slug}</ListRowMeta>
          </ListRow>
        ))}
        {pages.length === 0 && <ListEmpty>{t('site.noPages')}</ListEmpty>}
      </ListRows>
    </div>
  );
}
