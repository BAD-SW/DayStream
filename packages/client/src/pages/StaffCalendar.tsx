import { useState, useEffect } from 'react';
import { Button } from '../design-system/components/actions/Button';
import * as staffApi from '../api/staff';

export function StaffCalendar() {
  const [teamData, setTeamData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 1); // Monday
    return d.toISOString().split('T')[0];
  });

  const endDate = (() => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + 6);
    return d.toISOString().split('T')[0];
  })();

  useEffect(() => {
    setLoading(true);
    staffApi.getTeamCalendar(startDate, endDate)
      .then(setTeamData)
      .finally(() => setLoading(false));
  }, [startDate, endDate]);

  const prevWeek = () => {
    const d = new Date(startDate);
    d.setDate(d.getDate() - 7);
    setStartDate(d.toISOString().split('T')[0]);
  };

  const nextWeek = () => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + 7);
    setStartDate(d.toISOString().split('T')[0]);
  };

  const getDaysInRange = () => {
    const days: string[] = [];
    const d = new Date(startDate);
    for (let i = 0; i < 7; i++) {
      days.push(new Date(d.getTime() + i * 86400000).toISOString().split('T')[0]);
    }
    return days;
  };

  const days = getDaysInRange();
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Team Calendar</h1>
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={prevWeek}>← Prev</Button>
          <span className="text-sm font-medium">{startDate} — {endDate}</span>
          <Button variant="ghost" onClick={nextWeek}>Next →</Button>
        </div>
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border p-2 bg-gray-50 text-left w-40">Staff</th>
                {days.map((d, i) => (
                  <th key={d} className="border p-2 bg-gray-50 text-center">
                    {dayLabels[i]}<br /><span className="text-xs text-gray-500">{d.slice(5)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teamData.map((member: any) => (
                <tr key={member.staff.id}>
                  <td className="border p-2 font-medium">
                    {member.staff.firstName} {member.staff.lastName}
                  </td>
                  {days.map((day) => {
                    const dayBookings = member.bookings.filter((b: any) => b.date === day);
                    const hasLeave = member.leave.some((l: any) => l.startDate <= day && l.endDate >= day);
                    const avail = member.availability[day] || [];

                    return (
                      <td key={day} className={`border p-1 text-center ${hasLeave ? 'bg-orange-50' : avail.length > 0 ? 'bg-green-50' : 'bg-gray-50'}`}>
                        {hasLeave ? (
                          <span className="text-xs text-orange-600">Leave</span>
                        ) : dayBookings.length > 0 ? (
                          <span className="text-xs text-blue-600">{dayBookings.length} booking{dayBookings.length > 1 ? 's' : ''}</span>
                        ) : avail.length > 0 ? (
                          <span className="text-xs text-green-600">Available</span>
                        ) : (
                          <span className="text-xs text-gray-400">Off</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {teamData.length === 0 && (
                <tr>
                  <td colSpan={8} className="border p-4 text-center text-gray-500">No staff found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
