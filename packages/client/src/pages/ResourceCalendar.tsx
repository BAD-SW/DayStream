import { useState, useEffect } from 'react';
import { Button } from '../design-system/components/actions/Button';
import * as resourcesApi from '../api/resources';

export function ResourceCalendar() {
  const [timeline, setTimeline] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 1);
    return d.toISOString().split('T')[0];
  });

  const endDate = (() => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + 6);
    return d.toISOString().split('T')[0];
  })();

  useEffect(() => {
    setLoading(true);
    resourcesApi.getTimeline(startDate, endDate).then(setTimeline).finally(() => setLoading(false));
  }, [startDate, endDate]);

  const prevWeek = () => { const d = new Date(startDate); d.setDate(d.getDate() - 7); setStartDate(d.toISOString().split('T')[0]); };
  const nextWeek = () => { const d = new Date(startDate); d.setDate(d.getDate() + 7); setStartDate(d.toISOString().split('T')[0]); };

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    return d.toISOString().split('T')[0];
  });
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Resource Calendar</h1>
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={prevWeek}>← Prev</Button>
          <span className="text-sm font-medium">{startDate} — {endDate}</span>
          <Button variant="ghost" onClick={nextWeek}>Next →</Button>
        </div>
      </div>

      {loading ? <div>Loading...</div> : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border p-2 bg-gray-50 text-left w-48">Resource</th>
                {days.map((d, i) => (
                  <th key={d} className="border p-2 bg-gray-50 text-center">
                    {dayLabels[i]}<br /><span className="text-xs text-gray-500">{d.slice(5)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timeline.map((item: any) => (
                <tr key={item.resource.id}>
                  <td className="border p-2">
                    <div className="font-medium">{item.resource.name}</div>
                    <div className="text-xs text-gray-500">{item.resource.typeName}</div>
                  </td>
                  {days.map((day) => {
                    const dayBookings = item.bookings.filter((b: any) => b.startTime.split('T')[0] === day);
                    return (
                      <td key={day} className={`border p-1 text-center ${dayBookings.length > 0 ? 'bg-blue-50' : 'bg-green-50'}`}>
                        {dayBookings.length > 0 ? (
                          <span className="text-xs text-blue-600">{dayBookings.length} booking{dayBookings.length > 1 ? 's' : ''}</span>
                        ) : (
                          <span className="text-xs text-green-600">Available</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {timeline.length === 0 && (
                <tr><td colSpan={8} className="border p-4 text-center text-gray-500">No resources</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
