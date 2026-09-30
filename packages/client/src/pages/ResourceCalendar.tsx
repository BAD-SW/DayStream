import { useState, useEffect } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { ListEmpty } from '../design-system/components/data/ListRow';
import { PageHeader } from '../design-system/components/layout/PageHeader';
import './WeekGrid.css';
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
    <div>
      <PageHeader
        title="Resource Calendar"
        actions={<div className="wg-nav">
          <Button variant="ghost" onClick={prevWeek}>← Prev</Button>
          <span className="wg-range">{startDate} — {endDate}</span>
          <Button variant="ghost" onClick={nextWeek}>Next →</Button>
        </div>}
      />

      {loading ? <ListEmpty>Loading...</ListEmpty> : (
        <div className="wg-scroll">
          <table className="wg-table">
            <thead>
              <tr>
                <th className="wg-first">Resource</th>
                {days.map((d, i) => (
                  <th key={d}>
                    {dayLabels[i]}<span className="wg-date">{d.slice(5)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timeline.map((item: any) => (
                <tr key={item.resource.id}>
                  <td className="wg-first">
                    <div className="wg-name">{item.resource.name}</div>
                    <div className="wg-date">{item.resource.typeName}</div>
                  </td>
                  {days.map((day) => {
                    const dayBookings = item.bookings.filter((b: any) => b.startTime.split('T')[0] === day);
                    const booked = dayBookings.length > 0;
                    return (
                      <td key={day} className={`wg-cell wg-cell--${booked ? 'booked' : 'available'}`}>
                        {booked ? `${dayBookings.length} booking${dayBookings.length > 1 ? 's' : ''}` : 'Available'}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {timeline.length === 0 && (
                <tr><td colSpan={8} className="wg-empty">No resources</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
