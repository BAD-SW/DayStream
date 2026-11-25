import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDay } from '../utils/format';
import { Button } from '../design-system/components/actions/Button';
import { ListEmpty } from '../design-system/components/data/ListRow';
import { PageHeader } from '../design-system/components/layout/PageHeader';
import './WeekGrid.css';
import * as staffApi from '../api/staff';

export function StaffCalendar() {
  const { t } = useTranslation('calendar');
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

  return (
    <div>
      <PageHeader
        title={t('staffCalendar.title')}
        actions={<div className="wg-nav">
          <Button variant="ghost" onClick={prevWeek}>{t('weekCalendar.prev')}</Button>
          <span className="wg-range">{startDate} — {endDate}</span>
          <Button variant="ghost" onClick={nextWeek}>{t('weekCalendar.next')}</Button>
        </div>}
      />

      {loading ? (
        <ListEmpty>{t('weekCalendar.loading')}</ListEmpty>
      ) : (
        <div className="wg-scroll">
          <table className="wg-table">
            <thead>
              <tr>
                <th className="wg-first">{t('staffCalendar.staff')}</th>
                {days.map((d) => (
                  <th key={d}>
                    {formatDay(d, { weekday: 'short' })}<span className="wg-date">{d.slice(5)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teamData.map((member: any) => (
                <tr key={member.staff.id}>
                  <td className="wg-first wg-name">
                    {member.staff.firstName} {member.staff.lastName}
                  </td>
                  {days.map((day) => {
                    const dayBookings = member.bookings.filter((b: any) => b.date === day);
                    const hasLeave = member.leave.some((l: any) => l.startDate <= day && l.endDate >= day);
                    const avail = member.availability[day] || [];
                    const state = hasLeave ? 'leave' : dayBookings.length > 0 ? 'booked' : avail.length > 0 ? 'available' : 'off';
                    const label = state === 'leave' ? t('staffCalendar.leave')
                      : state === 'booked' ? t('weekCalendar.booking', { count: dayBookings.length })
                      : state === 'available' ? t('weekCalendar.available') : t('staffCalendar.off');

                    return (
                      <td key={day} className={`wg-cell wg-cell--${state}`}>{label}</td>
                    );
                  })}
                </tr>
              ))}
              {teamData.length === 0 && (
                <tr>
                  <td colSpan={8} className="wg-empty">{t('staffCalendar.noStaff')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
