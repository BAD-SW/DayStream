import { adminPool } from '../db/pool';

/**
 * Who works on a day, per service (calendar Day view: "3 staff working" under each service and the
 * By Staff columns, CAL-8 a). Same rules as the availability engine, at day level:
 * - eligible staff: the active staff assigned to the service; none assigned = every active staff member;
 * - scheduling mode "schedule": a staff member works the day (with shift entries, within them; without,
 *   unscheduled = no restrictions);
 * - otherwise availability patterns: a "remove" override = day off; an add / modify override = works;
 *   no pattern at all = no restrictions; patterns but none for that weekday (in force) = day off.
 * Resource-only services have no staff.
 */
export async function staffWorkingOnDay(businessId: string, date: string, serviceIds: string[], locationId?: string): Promise<{ byService: Record<string, string[]>; names: Map<string, string> }> {
  const byService: Record<string, string[]> = {};
  const names = new Map<string, string>();
  if (serviceIds.length === 0) return { byService, names };

  const { rows: biz } = await adminPool.query('SELECT scheduling_mode FROM sys_businesses WHERE id = $1', [businessId]);
  const mode = biz[0]?.scheduling_mode || 'availability';

  const { rows: svcs } = await adminPool.query('SELECT id, booking_type FROM svc_services WHERE id = ANY($1::uuid[])', [serviceIds]);
  const { rows: assigned } = await adminPool.query(
    `SELECT ss.service_id, ss.user_id, u.first_name, u.last_name
       FROM svc_staff ss JOIN usr_users u ON u.id = ss.user_id
       LEFT JOIN stf_profiles sp ON sp.user_id = u.id
      WHERE ss.service_id = ANY($1::uuid[]) AND u.status = 'active' AND COALESCE(sp.status, 'active') = 'active'`,
    [serviceIds],
  );
  const { rows: all } = await adminPool.query(
    `SELECT DISTINCT sp.user_id, sp.first_name, sp.last_name
       FROM stf_profiles sp JOIN usr_users u ON u.id = sp.user_id
      WHERE u.business_id = $1 AND sp.status = 'active' AND sp.user_id IS NOT NULL`,
    [businessId],
  );
  for (const r of [...all, ...assigned]) names.set(r.user_id, `${r.first_name || ''} ${r.last_name || ''}`.trim());

  // one location: the staff assigned to it (Business Setup → Locations → staff); none assigned there = everyone
  let atLocation: Set<string> | null = null;
  if (locationId) {
    const { rows: ls } = await adminPool.query(
      'SELECT sp.user_id FROM sys_location_staff ls JOIN stf_profiles sp ON sp.id = ls.staff_id WHERE ls.location_id = $1 AND sp.user_id IS NOT NULL', [locationId],
    );
    if (ls.length) atLocation = new Set(ls.map((r: any) => r.user_id));
  }
  const userIds = [...names.keys()];
  const dow = new Date(date + 'T12:00:00Z').getUTCDay();
  let works: (uid: string) => boolean = () => true;
  if (mode !== 'schedule' && userIds.length) {
    const { rows: pats } = await adminPool.query(
      `SELECT sp.user_id, ps.day_of_week, p.effective_from::text AS ef, p.effective_to::text AS et
         FROM stf_availability_patterns p JOIN stf_profiles sp ON sp.id = p.staff_id
         JOIN stf_availability_pattern_slots ps ON ps.pattern_id = p.id
        WHERE sp.user_id = ANY($1) AND p.is_default = true`, [userIds],
    );
    const { rows: ovs } = await adminPool.query(
      `SELECT sp.user_id, o.override_type FROM stf_availability_overrides o JOIN stf_profiles sp ON sp.id = o.staff_id
        WHERE sp.user_id = ANY($1) AND o.override_date = $2::date`, [userIds, date],
    );
    works = (uid) => {
      const o = ovs.find((x: any) => x.user_id === uid);
      if (o) return o.override_type !== 'remove';
      const mine = pats.filter((p: any) => p.user_id === uid);
      if (mine.length === 0) return true;
      return mine.some((p: any) => p.day_of_week === dow && (!p.ef || date >= p.ef.slice(0, 10)) && (!p.et || date <= p.et.slice(0, 10)));
    };
  }
  for (const s of svcs) {
    if (s.booking_type === 'resource') { byService[s.id] = []; continue; }
    const mine = assigned.filter((a: any) => a.service_id === s.id).map((a: any) => a.user_id);
    const eligible = mine.length ? [...new Set(mine)] : all.map((a: any) => a.user_id);
    byService[s.id] = (eligible as string[]).filter((id) => works(id) && (!atLocation || atLocation.has(id)));
  }
  return { byService, names };
}
