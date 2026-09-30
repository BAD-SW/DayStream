import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { PageHeader } from '../design-system/components/layout/PageHeader';
import { ListRow, ListRows, ListRowTitle, ListRowMeta, ListEmpty } from '../design-system/components/data/ListRow';
import * as cmsApi from '../api/cms';
import './CMS.css';

export function CMS() {
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

  if (loading) return <p className="cms-muted">Loading...</p>;

  return (
    <div>
      <PageHeader
        title="Website & CMS"
        actions={<>
          <Button onClick={() => cmsApi.publishSite().then(setSite)}>Publish Site</Button>
          <Button variant="ghost" onClick={() => navigate('/cms/blog')}>Blog</Button>
          <Button variant="ghost" onClick={() => navigate('/cms/media')}>Media</Button>
        </>}
      />

      {site && (
        <div className="cms-site">
          <div className="cms-site__row">
            <div className="cms-site__hosting">
              <span className="cms-muted">Hosting:</span>
              <Badge variant={site.hosting_tier === 'custom_domain' ? 'success' : 'info'}>{site.hosting_tier}</Badge>
              {site.custom_domain && <span>{site.custom_domain}</span>}
            </div>
            <Badge variant={site.is_published ? 'success' : 'neutral'}>{site.is_published ? 'Published' : 'Draft'}</Badge>
          </div>
          <div className="cms-muted">
            Subdomain: <code>{site.slug}.daystream.app</code>
          </div>
        </div>
      )}

      <h2 className="cms-section-title">Pages</h2>
      <ListRows>
        {pages.map((p: any) => (
          <ListRow
            key={p.id}
            onClick={() => navigate(`/cms/pages/${p.id}`)}
            actions={<>
              <Badge variant={p.is_enabled ? 'success' : 'neutral'}>{p.is_enabled ? 'Enabled' : 'Disabled'}</Badge>
              <Badge variant={p.status === 'published' ? 'success' : 'neutral'}>{p.status}</Badge>
            </>}
          >
            <ListRowTitle>{p.title}</ListRowTitle>
            <ListRowMeta>/{p.slug}</ListRowMeta>
          </ListRow>
        ))}
        {pages.length === 0 && <ListEmpty>No pages yet. Apply a template to get started.</ListEmpty>}
      </ListRows>
    </div>
  );
}
