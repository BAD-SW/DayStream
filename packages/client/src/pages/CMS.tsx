import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import * as cmsApi from '../api/cms';

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

  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Website & CMS</h1>
        <div className="flex gap-2">
          <Button onClick={() => cmsApi.publishSite().then(setSite)}>Publish Site</Button>
          <Button variant="ghost" onClick={() => navigate('/cms/blog')}>Blog</Button>
          <Button variant="ghost" onClick={() => navigate('/cms/media')}>Media</Button>
        </div>
      </div>

      {site && (
        <div className="border rounded-lg p-4 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <span className="text-sm text-gray-500">Hosting:</span>{' '}
              <Badge variant={site.hosting_tier === 'custom_domain' ? 'success' : 'info'}>{site.hosting_tier}</Badge>
              {site.custom_domain && <span className="ml-3 text-sm">{site.custom_domain}</span>}
            </div>
            <Badge variant={site.is_published ? 'success' : 'neutral'}>{site.is_published ? 'Published' : 'Draft'}</Badge>
          </div>
          <div className="text-sm text-gray-500 mt-2">
            Subdomain: <code>{site.slug}.daystream.app</code>
          </div>
        </div>
      )}

      <h2 className="text-lg font-medium mb-3">Pages</h2>
      <div className="space-y-2">
        {pages.map((p: any) => (
          <div key={p.id} className="border rounded p-3 flex justify-between items-center cursor-pointer hover:border-blue-300"
            onClick={() => navigate(`/cms/pages/${p.id}`)}>
            <div>
              <span className="font-medium">{p.title}</span>
              <span className="text-sm text-gray-500 ml-2">/{p.slug}</span>
            </div>
            <div className="flex gap-2 items-center">
              <Badge variant={p.is_enabled ? 'success' : 'neutral'}>{p.is_enabled ? 'Enabled' : 'Disabled'}</Badge>
              <Badge variant={p.status === 'published' ? 'success' : 'neutral'}>{p.status}</Badge>
            </div>
          </div>
        ))}
        {pages.length === 0 && <p className="text-gray-500">No pages yet. Apply a template to get started.</p>}
      </div>
    </div>
  );
}
