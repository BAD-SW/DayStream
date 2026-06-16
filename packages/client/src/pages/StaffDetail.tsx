import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import * as staffApi from '../api/staff';
import type { StaffProfile, Qualification, AvailabilityPattern } from '../api/staff';

type Tab = 'profile' | 'qualifications' | 'availability' | 'services' | 'calendar' | 'capacity';

export function StaffDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [staff, setStaff] = useState<StaffProfile | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    staffApi.getStaff(id).then(setStaff).catch(() => navigate('/staff')).finally(() => setLoading(false));
  }, [id, navigate]);

  if (loading) return <div className="p-6">Loading...</div>;
  if (!staff) return <div className="p-6">Staff not found</div>;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'profile', label: 'Profile' },
    { key: 'qualifications', label: 'Qualifications' },
    { key: 'availability', label: 'Availability' },
    { key: 'services', label: 'Services & Locations' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'capacity', label: 'Capacity' },
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Button variant="ghost" onClick={() => navigate('/staff')}>← Back</Button>
          <h1 className="text-2xl font-semibold mt-2">
            {staff.first_name} {staff.last_name}
            <span className="text-sm text-gray-500 ml-2">{staff.staff_ref}</span>
          </h1>
        </div>
        <Badge variant={staff.status === 'active' ? 'success' : 'warning'}>
          {staff.status}
        </Badge>
      </div>

      <div className="border-b mb-6">
        <nav className="flex gap-4">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`pb-2 px-1 text-sm font-medium border-b-2 ${
                activeTab === tab.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'profile' && <ProfileTab staff={staff} onUpdate={setStaff} />}
      {activeTab === 'qualifications' && <QualificationsTab staffId={staff.id} />}
      {activeTab === 'availability' && <AvailabilityTab staffId={staff.id} />}
      {activeTab === 'services' && <ServicesTab staffId={staff.id} />}
      {activeTab === 'calendar' && <CalendarTab staffId={staff.id} />}
      {activeTab === 'capacity' && <CapacityTab staffId={staff.id} />}
    </div>
  );
}

function ProfileTab({ staff, onUpdate }: { staff: StaffProfile; onUpdate: (s: StaffProfile) => void }) {
  const handleDeactivate = async () => {
    if (!confirm('Deactivate this staff member?')) return;
    const updated = await staffApi.deactivateStaff(staff.id);
    onUpdate(updated);
  };

  return (
    <div className="grid grid-cols-2 gap-6">
      <div className="space-y-3">
        <div><span className="text-gray-500 text-sm">Email:</span> <span>{staff.email || '—'}</span></div>
        <div><span className="text-gray-500 text-sm">Phone:</span> <span>{staff.mobile_phone || '—'}</span></div>
        <div><span className="text-gray-500 text-sm">Employment:</span> <span>{staff.employment_type.replace('_', ' ')}</span></div>
        <div><span className="text-gray-500 text-sm">Hire Date:</span> <span>{staff.hire_date || '—'}</span></div>
        <div><span className="text-gray-500 text-sm">Languages:</span> <span>{staff.languages || '—'}</span></div>
      </div>
      <div className="space-y-3">
        <div><span className="text-gray-500 text-sm">Bio:</span></div>
        <p className="text-sm">{staff.bio || 'No bio set'}</p>
        {staff.status === 'active' && (
          <Button variant="destructive" onClick={handleDeactivate}>Deactivate</Button>
        )}
      </div>
    </div>
  );
}

function QualificationsTab({ staffId }: { staffId: string }) {
  const [quals, setQuals] = useState<Qualification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    staffApi.getQualifications(staffId).then(setQuals).finally(() => setLoading(false));
  }, [staffId]);

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-medium">Qualifications & Certifications</h3>
      </div>
      {quals.length === 0 ? (
        <p className="text-gray-500 text-sm">No qualifications recorded</p>
      ) : (
        <div className="space-y-3">
          {quals.map((q) => (
            <div key={q.id} className="border rounded p-3">
              <div className="flex justify-between">
                <span className="font-medium">{q.name}</span>
                {q.expiry_date && (
                  <Badge variant={new Date(q.expiry_date) < new Date() ? 'error' : 'info'}>
                    Expires: {q.expiry_date}
                  </Badge>
                )}
              </div>
              {q.issuing_body && <div className="text-sm text-gray-500">Issued by: {q.issuing_body}</div>}
              {q.certification_number && <div className="text-sm text-gray-500">Cert #: {q.certification_number}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AvailabilityTab({ staffId }: { staffId: string }) {
  const [patterns, setPatterns] = useState<AvailabilityPattern[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    staffApi.getAvailabilityPatterns(staffId).then(setPatterns).finally(() => setLoading(false));
  }, [staffId]);

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h3 className="font-medium mb-4">Availability Patterns</h3>
      {patterns.length === 0 ? (
        <p className="text-gray-500 text-sm">No availability patterns defined</p>
      ) : (
        <div className="space-y-4">
          {patterns.map((p) => (
            <div key={p.id} className="border rounded p-4">
              <div className="flex justify-between items-center mb-2">
                <span className="font-medium">{p.name}</span>
                <span className="text-sm text-gray-500">
                  {p.effective_from} → {p.effective_to || 'Ongoing'}
                </span>
              </div>
              <div className="grid grid-cols-7 gap-1 text-xs">
                {dayNames.map((day, idx) => {
                  const slots = p.slots.filter((s) => s.day_of_week === idx);
                  return (
                    <div key={idx} className="text-center">
                      <div className="font-medium">{day}</div>
                      {slots.length === 0 ? (
                        <div className="text-gray-300">Off</div>
                      ) : (
                        slots.map((s, i) => (
                          <div key={i} className="text-green-600">{s.start_time.slice(0,5)}-{s.end_time.slice(0,5)}</div>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ServicesTab({ staffId }: { staffId: string }) {
  const [assignments, setAssignments] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      staffApi.getServiceAssignments(staffId),
      staffApi.getLocationAssignments(staffId),
    ]).then(([svc, loc]) => {
      setAssignments(svc);
      setLocations(loc);
    }).finally(() => setLoading(false));
  }, [staffId]);

  if (loading) return <div>Loading...</div>;

  return (
    <div className="grid grid-cols-2 gap-6">
      <div>
        <h3 className="font-medium mb-3">Service Assignments</h3>
        {assignments.length === 0 ? (
          <p className="text-gray-500 text-sm">No services assigned</p>
        ) : (
          <div className="space-y-2">
            {assignments.map((a: any) => (
              <div key={a.id} className="border rounded p-2 flex justify-between items-center">
                <span>{a.service_name}{a.variant_name ? ` (${a.variant_name})` : ''}</span>
                {a.is_primary && <Badge variant="info">Primary</Badge>}
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <h3 className="font-medium mb-3">Location Assignments</h3>
        {locations.length === 0 ? (
          <p className="text-gray-500 text-sm">No locations assigned</p>
        ) : (
          <div className="space-y-2">
            {locations.map((l: any) => (
              <div key={l.id} className="border rounded p-2 flex justify-between items-center">
                <span>{l.location_id}</span>
                {l.is_primary && <Badge variant="info">Primary</Badge>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CalendarTab({ staffId }: { staffId: string }) {
  const [calendar, setCalendar] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = new Date();
    const start = today.toISOString().split('T')[0];
    const end = new Date(today.getTime() + 7 * 86400000).toISOString().split('T')[0];
    staffApi.getStaffCalendar(staffId, start, end).then(setCalendar).finally(() => setLoading(false));
  }, [staffId]);

  if (loading) return <div>Loading...</div>;
  if (!calendar) return <div>Failed to load calendar</div>;

  return (
    <div>
      <h3 className="font-medium mb-4">This Week's Schedule</h3>
      <div className="space-y-2">
        {calendar.bookings.length === 0 ? (
          <p className="text-gray-500 text-sm">No bookings this week</p>
        ) : (
          calendar.bookings.map((b: any) => (
            <div key={b.id} className="border rounded p-2 flex justify-between">
              <span>{b.serviceName} — {b.customerName || 'Unknown'}</span>
              <span className="text-sm text-gray-500">{new Date(b.startTime).toLocaleString()}</span>
            </div>
          ))
        )}
      </div>
      {calendar.leave.length > 0 && (
        <div className="mt-4">
          <h4 className="font-medium text-sm mb-2">Leave</h4>
          {calendar.leave.map((l: any) => (
            <div key={l.id} className="border border-orange-200 bg-orange-50 rounded p-2">
              {l.leaveType}: {l.startDate} → {l.endDate}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CapacityTab({ staffId }: { staffId: string }) {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    staffApi.getCapacity(staffId).then(setConfig).finally(() => setLoading(false));
  }, [staffId]);

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h3 className="font-medium mb-4">Capacity Configuration</h3>
      <div className="space-y-3">
        <div className="border rounded p-3">
          <span className="text-gray-500 text-sm">Max bookings per day:</span>{' '}
          <span className="font-medium">{config?.max_bookings_per_day ?? 'Unlimited'}</span>
        </div>
        <div className="border rounded p-3">
          <span className="text-gray-500 text-sm">Max bookings per week:</span>{' '}
          <span className="font-medium">{config?.max_bookings_per_week ?? 'Unlimited'}</span>
        </div>
        <div className="border rounded p-3">
          <span className="text-gray-500 text-sm">Max consecutive hours:</span>{' '}
          <span className="font-medium">{config?.max_consecutive_hours ?? 'Unlimited'}</span>
        </div>
      </div>
    </div>
  );
}
