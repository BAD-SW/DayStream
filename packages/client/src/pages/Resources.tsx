import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { SearchInput } from '../design-system/components/actions/SearchInput';
import { Badge } from '../design-system/components/data/Badge';
import * as resourcesApi from '../api/resources';
import type { Resource, ResourceType } from '../api/resources';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
  active: 'success', inactive: 'neutral', maintenance: 'warning',
};

export function Resources() {
  const navigate = useNavigate();
  const [resources, setResources] = useState<Resource[]>([]);
  const [types, setTypes] = useState<ResourceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => { resourcesApi.getResourceTypes().then(setTypes).catch(() => {}); }, []);

  const fetchResources = useCallback(async () => {
    setLoading(true);
    try {
      const result = await resourcesApi.getResources({
        search: search || undefined,
        resource_type_id: typeFilter || undefined,
        category: categoryFilter || undefined,
        page, limit: 50,
      });
      setResources(result.data);
      setTotal(result.meta?.total || 0);
    } catch {} finally { setLoading(false); }
  }, [search, typeFilter, categoryFilter, page]);

  useEffect(() => { fetchResources(); }, [fetchResources]);

  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Group by category
  const grouped = resources.reduce((acc, r) => {
    const cat = r.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(r);
    return acc;
  }, {} as Record<string, Resource[]>);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Resources</h1>
        <Button onClick={() => navigate('/resources/new')}>Add Resource</Button>
      </div>

      <div className="flex gap-4 mb-4">
        <SearchInput value={searchInput} onChange={setSearchInput} placeholder="Search resources..." />
        <select className="border rounded px-3 py-2 text-sm" value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}>
          <option value="">All categories</option>
          <option value="room">Rooms</option>
          <option value="equipment">Equipment</option>
          <option value="facility">Facilities</option>
        </select>
        <select className="border rounded px-3 py-2 text-sm" value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
          <option value="">All types</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {loading ? <div>Loading...</div> : (
        Object.entries(grouped).length === 0 ? (
          <p className="text-gray-500">No resources found</p>
        ) : (
          Object.entries(grouped).map(([cat, items]) => (
            <div key={cat} className="mb-6">
              <h2 className="text-lg font-medium mb-3 capitalize">{cat}s</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {items.map((r) => (
                  <div key={r.id} className="border rounded-lg p-4 cursor-pointer hover:border-blue-300 transition"
                    onClick={() => navigate(`/resources/${r.id}`)}>
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-medium">{r.name}</h3>
                        <p className="text-sm text-gray-500">{r.type_name}</p>
                      </div>
                      <Badge variant={STATUS_VARIANTS[r.status] || 'neutral'}>{r.status}</Badge>
                    </div>
                    <div className="mt-2 flex gap-3 text-xs text-gray-500">
                      <span>Capacity: {r.capacity}</span>
                      {r.buffer_minutes > 0 && <span>Buffer: {r.buffer_minutes}min</span>}
                      {r.is_24_7 && <span>24/7</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )
      )}

      {total > 50 && (
        <div className="flex justify-center gap-2 mt-4">
          <Button variant="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="px-3 py-2 text-sm">Page {page}</span>
          <Button variant="ghost" onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
