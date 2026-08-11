import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { Button } from '../design-system/components/actions/Button';

interface Category {
  id: string;
  google_type: string;
  label: string;
  created_at: string;
}

const GOOGLE_PLACE_TYPES: { type: string; label: string }[] = [
  { type: 'accounting', label: 'Accounting' },
  { type: 'airport', label: 'Airport' },
  { type: 'amusement_park', label: 'Amusement Park' },
  { type: 'aquarium', label: 'Aquarium' },
  { type: 'art_gallery', label: 'Art Gallery' },
  { type: 'atm', label: 'ATM' },
  { type: 'bakery', label: 'Bakery' },
  { type: 'bank', label: 'Bank' },
  { type: 'bar', label: 'Bar' },
  { type: 'beauty_salon', label: 'Beauty Salon' },
  { type: 'bicycle_store', label: 'Bicycle Store' },
  { type: 'book_store', label: 'Book Store' },
  { type: 'bowling_alley', label: 'Bowling Alley' },
  { type: 'bus_station', label: 'Bus Station' },
  { type: 'cafe', label: 'Cafe' },
  { type: 'campground', label: 'Campground' },
  { type: 'car_dealer', label: 'Car Dealer' },
  { type: 'car_rental', label: 'Car Rental' },
  { type: 'car_repair', label: 'Car Repair' },
  { type: 'car_wash', label: 'Car Wash' },
  { type: 'casino', label: 'Casino' },
  { type: 'cemetery', label: 'Cemetery' },
  { type: 'church', label: 'Church' },
  { type: 'city_hall', label: 'City Hall' },
  { type: 'clothing_store', label: 'Clothing Store' },
  { type: 'convenience_store', label: 'Convenience Store' },
  { type: 'courthouse', label: 'Courthouse' },
  { type: 'dentist', label: 'Dentist' },
  { type: 'department_store', label: 'Department Store' },
  { type: 'doctor', label: 'Doctor' },
  { type: 'drugstore', label: 'Drugstore' },
  { type: 'electrician', label: 'Electrician' },
  { type: 'electronics_store', label: 'Electronics Store' },
  { type: 'embassy', label: 'Embassy' },
  { type: 'fire_station', label: 'Fire Station' },
  { type: 'florist', label: 'Florist' },
  { type: 'funeral_home', label: 'Funeral Home' },
  { type: 'furniture_store', label: 'Furniture Store' },
  { type: 'gas_station', label: 'Gas Station' },
  { type: 'gym', label: 'Gym' },
  { type: 'hair_care', label: 'Hair Care' },
  { type: 'hardware_store', label: 'Hardware Store' },
  { type: 'health', label: 'Health & Wellness' },
  { type: 'hindu_temple', label: 'Hindu Temple' },
  { type: 'home_goods_store', label: 'Home Goods Store' },
  { type: 'hospital', label: 'Hospital' },
  { type: 'insurance_agency', label: 'Insurance Agency' },
  { type: 'jewelry_store', label: 'Jewelry Store' },
  { type: 'laundry', label: 'Laundry' },
  { type: 'lawyer', label: 'Lawyer' },
  { type: 'library', label: 'Library' },
  { type: 'light_rail_station', label: 'Light Rail Station' },
  { type: 'liquor_store', label: 'Liquor Store' },
  { type: 'local_government_office', label: 'Local Government Office' },
  { type: 'locksmith', label: 'Locksmith' },
  { type: 'lodging', label: 'Lodging / Hotel' },
  { type: 'meal_delivery', label: 'Meal Delivery' },
  { type: 'meal_takeaway', label: 'Meal Takeaway' },
  { type: 'mosque', label: 'Mosque' },
  { type: 'movie_rental', label: 'Movie Rental' },
  { type: 'movie_theater', label: 'Movie Theater' },
  { type: 'moving_company', label: 'Moving Company' },
  { type: 'museum', label: 'Museum' },
  { type: 'night_club', label: 'Night Club' },
  { type: 'painter', label: 'Painter' },
  { type: 'park', label: 'Park' },
  { type: 'parking', label: 'Parking' },
  { type: 'pet_store', label: 'Pet Store' },
  { type: 'pharmacy', label: 'Pharmacy' },
  { type: 'physiotherapist', label: 'Physiotherapist' },
  { type: 'plumber', label: 'Plumber' },
  { type: 'police', label: 'Police' },
  { type: 'post_office', label: 'Post Office' },
  { type: 'primary_school', label: 'Primary School' },
  { type: 'real_estate_agency', label: 'Real Estate Agency' },
  { type: 'restaurant', label: 'Restaurant' },
  { type: 'roofing_contractor', label: 'Roofing Contractor' },
  { type: 'rv_park', label: 'RV Park' },
  { type: 'school', label: 'School' },
  { type: 'secondary_school', label: 'Secondary School' },
  { type: 'shoe_store', label: 'Shoe Store' },
  { type: 'shopping_mall', label: 'Shopping Mall' },
  { type: 'spa', label: 'Spa' },
  { type: 'stadium', label: 'Stadium' },
  { type: 'storage', label: 'Storage' },
  { type: 'store', label: 'Store (General)' },
  { type: 'subway_station', label: 'Subway Station' },
  { type: 'supermarket', label: 'Supermarket' },
  { type: 'synagogue', label: 'Synagogue' },
  { type: 'taxi_stand', label: 'Taxi Stand' },
  { type: 'tourist_attraction', label: 'Tourist Attraction' },
  { type: 'train_station', label: 'Train Station' },
  { type: 'transit_station', label: 'Transit Station' },
  { type: 'travel_agency', label: 'Travel Agency' },
  { type: 'university', label: 'University' },
  { type: 'veterinary_care', label: 'Veterinary Care' },
  { type: 'zoo', label: 'Zoo' },
  { type: 'yoga_studio', label: 'Yoga Studio' },
  { type: 'pilates_studio', label: 'Pilates Studio' },
  { type: 'personal_trainer', label: 'Personal Trainer' },
  { type: 'massage', label: 'Massage Therapy' },
  { type: 'swimming_pool', label: 'Swimming Pool' },
];

export function ProspectCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ google_type: '', label: '' });

  const fetchCategories = async () => {
    try {
      const res = await apiClient.get('/v1/prospects/categories');
      setCategories(res.data.data || []);
    } catch { setCategories([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchCategories(); }, []);

  const handleAdd = async () => {
    if (!form.google_type.trim() || !form.label.trim()) { alert('Both fields are required'); return; }
    try {
      await apiClient.post('/v1/prospects/categories', form);
      setForm({ google_type: '', label: '' });
      setShowAdd(false);
      fetchCategories();
    } catch (err: any) { alert(err.response?.data?.error || 'Failed to add category'); }
  };

  const handleRemove = async (id: string) => {
    if (!confirm('Remove this category? It will no longer be used in prospect searches.')) return;
    try {
      await apiClient.delete(`/v1/prospects/categories/${id}`);
      fetchCategories();
    } catch { alert('Failed to remove category'); }
  };

  if (loading) return <div style={styles.page}><p style={styles.muted}>Loading...</p></div>;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Prospect Categories</h1>
          <p style={styles.description}>Google Places business types used when generating prospect lists.</p>
        </div>
        <Button onClick={() => setShowAdd(!showAdd)}>{showAdd ? 'Cancel' : 'Add Category'}</Button>
      </div>

      {showAdd && (
        <div style={styles.addForm}>
          <select
            style={styles.input}
            value={form.google_type}
            onChange={(e) => {
              const selected = GOOGLE_PLACE_TYPES.find(t => t.type === e.target.value);
              setForm({ google_type: e.target.value, label: selected?.label || '' });
            }}
          >
            <option value="">Select a category...</option>
            {GOOGLE_PLACE_TYPES.filter(t => !categories.some(c => c.google_type === t.type)).map(t => (
              <option key={t.type} value={t.type}>{t.label} ({t.type})</option>
            ))}
          </select>
          <input
            style={styles.input}
            type="text"
            placeholder="Display label"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
          <Button size="sm" onClick={handleAdd}>Save</Button>
        </div>
      )}

      <div style={styles.list}>
        {categories.length === 0 ? (
          <p style={styles.muted}>No categories configured.</p>
        ) : (
          categories.map((cat) => (
            <div key={cat.id} style={styles.row}>
              <div style={styles.rowInfo}>
                <span style={styles.rowLabel}>{cat.label}</span>
                <span style={styles.rowType}>{cat.google_type}</span>
              </div>
              <div style={styles.rowActions}>
                <button style={styles.removeBtn} onClick={() => handleRemove(cat.id)}>Remove</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: '800px', margin: '0 auto', padding: 'var(--space-lg)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 300, margin: '0 0 4px', color: 'var(--color-text)' },
  description: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 },
  muted: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' },
  addForm: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', marginBottom: 'var(--space-lg)', padding: 'var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)' },
  input: { padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', background: 'var(--color-background)', flex: 1 },
  list: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' },
  rowInfo: { display: 'flex', flexDirection: 'column' as const, gap: '2px' },
  rowLabel: { fontSize: '14px', fontWeight: 600, color: 'var(--color-text)' },
  rowType: { fontSize: '12px', color: 'var(--color-text-secondary)', fontFamily: 'monospace' },
  rowActions: { display: 'flex', gap: '8px', alignItems: 'center' },
  removeBtn: { background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer', fontSize: '12px', padding: '4px 8px' },
  inactiveTag: { fontSize: '11px', color: 'var(--color-text-secondary)', fontStyle: 'italic' as const },
};
