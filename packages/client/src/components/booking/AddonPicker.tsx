import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as addonsApi from '../../api/addons';
import type { ServiceAddon } from '../../api/addons';
import { formatCurrency } from '../../utils/currency';

/** An add-on the appointment already has: its name and the price it had when chosen. */
export interface ChosenAddon { addon_id: string; name: string; price: number; paid: boolean; /** apt_booking_addons.id */ booking_addon_id?: string }

/**
 * The add-ons of the service being booked (spec 51, gap 15, criterion 3): none, one or several,
 * each with its price. They add no time. One the appointment already has shows the price it had
 * when chosen; one already paid is taken off through onRemovePaid (with a refund choice). When the service changes, add-ons the
 * new service does not offer are dropped and named.
 */
export function AddonPicker({ businessId, serviceId, value, onChange, kept, pruneOnLoad, disabled, onRemovePaid }: {
  businessId: string; serviceId: string;
  value: string[]; onChange: (ids: string[]) => void;
  /** What the appointment has (edit), with prices as chosen. */
  kept: ChosenAddon[];
  /** Drop chosen add-ons the service does not offer once its list is loaded (a new or changed service). */
  pruneOnLoad: boolean;
  disabled?: boolean;
  /** A paid add-on clicked: ask how to refund it before taking it off. */
  onRemovePaid?: (a: ChosenAddon) => void;
}) {
  const { t } = useTranslation('booking');
  const [offered, setOffered] = useState<ServiceAddon[] | null>(null);
  const [dropped, setDropped] = useState<string[]>([]);
  const latest = useRef({ value, onChange, kept, pruneOnLoad });
  const previous = useRef<ServiceAddon[]>([]);
  latest.current = { value, onChange, kept, pruneOnLoad };

  useEffect(() => {
    setOffered(null); setDropped([]);
    if (!serviceId || !businessId) return;
    let live = true;
    addonsApi.getServiceAddons(serviceId, businessId).then((list) => {
      if (!live) return;
      const before = previous.current;
      previous.current = list;
      setOffered(list);
      const { value: v, onChange: change, kept: k, pruneOnLoad: prune } = latest.current;
      if (!prune) return;
      const keep = v.filter((id) => list.some((o) => o.addon_id === id) || k.some((x) => x.addon_id === id && x.paid));
      if (keep.length !== v.length) {
        setDropped(v.filter((id) => !keep.includes(id)).map((id) => k.find((x) => x.addon_id === id)?.name || before.find((x) => x.addon_id === id)?.name || t('addons.fallbackName')));
        change(keep);
      }
    }).catch(() => { if (live) setOffered([]); });
    return () => { live = false; };
  }, [serviceId, businessId]);

  if (!serviceId || offered === null) return null;
  // What is shown: the service's add-ons, and any the appointment has that it no longer offers.
  const extra = kept.filter((k) => value.includes(k.addon_id) && !offered.some((o) => o.addon_id === k.addon_id));
  if (offered.length === 0 && extra.length === 0) return dropped.length ? <p className="mk-hint">{t('addons.notOffered', { names: dropped.join(', ') })}</p> : null;

  const toggle = (id: string) => {
    const paid = kept.find((x) => x.addon_id === id && x.paid);
    if (paid && value.includes(id)) { onRemovePaid?.(paid); return; }
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };
  return (
    <div className="mk-f">
      <div className="mk-l">{t('addons.label')}</div>
      <div className="chips" role="group" aria-label={t('addons.label')}>
        {offered.map((o) => {
          const on = value.includes(o.addon_id);
          const k = kept.find((x) => x.addon_id === o.addon_id);
          const price = k ? k.price : o.price;
          const paid = !!k?.paid && on;
          return (
            <button key={o.addon_id} type="button" className="ch" aria-pressed={on} onClick={() => toggle(o.addon_id)}
              disabled={disabled || (paid && !onRemovePaid)} title={paid ? t('addons.paidTitle') : o.description || undefined}>
              + {o.name} <small>{paid ? t('addons.pricePaid', { price: formatCurrency(price) }) : formatCurrency(price)}</small>
            </button>
          );
        })}
        {extra.map((k) => (
          <button key={k.addon_id} type="button" className="ch" aria-pressed onClick={() => toggle(k.addon_id)} disabled={disabled || (k.paid && !onRemovePaid)} title={k.paid ? t('addons.paidTitle') : undefined}>
            + {k.name} <small>{k.paid ? t('addons.pricePaid', { price: formatCurrency(k.price) }) : formatCurrency(k.price)}</small>
          </button>
        ))}
      </div>
      {dropped.length > 0 && <p className="mk-hint">{t('addons.notOffered', { names: dropped.join(', ') })}</p>}
    </div>
  );
}
