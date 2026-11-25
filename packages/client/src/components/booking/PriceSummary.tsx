import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../../api/client';
import { formatCurrency } from '../../utils/currency';
import type { PaymentRule } from '../../api/services';
import type { BenefitRef } from '../../api/bookings';

// ============================================================
// What the appointment costs, shown in New Appointment as soon as a service and option are chosen,
// and updated as the choices change (customer, option, number of people). It uses the payment
// step's own price (POST /bookings/payment-quote: price, a membership or package chosen, tax), so the
// numbers are the ones the booking will have. Add-ons (spec 51, gap 15) will appear as lines here.
// ============================================================

interface Line { label: string; amount: number }

/** The booking:* key of the line saying when each payment rule is paid. */
const WHEN: Record<PaymentRule, string> = {
  no_card: 'price.when.no_card',
  card_required: 'price.when.card_required',
  charge_at_booking: 'price.when.charge_at_booking',
};

export function PriceSummary({ businessId, customerId, serviceId, variantId, participants, rule, benefit, startTime, addons }: {
  businessId: string; customerId: string | null; serviceId: string; variantId: string; participants: number; rule?: PaymentRule;
  /** The membership or package chosen to pay (spec 51, gap 19), and when it is for. */
  benefit?: BenefitRef | null; startTime?: string | null;
  /** The add-ons chosen (spec 51, gap 15): each its own line. */
  addons?: string[];
}) {
  const { t } = useTranslation('booking');
  const addonKey = (addons || []).join(',');
  const [lines, setLines] = useState<Line[] | null>(null);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!businessId || !serviceId || !variantId) { setLines(null); return; }
    let off = false;
    setFailed(false);
    // A short pause, so quick clicks through the options ask for the price once.
    const t = window.setTimeout(() => {
      apiClient.post(`/v1/bookings/payment-quote?business_id=${businessId}`, {
        business_id: businessId, customer_id: customerId, service_id: serviceId, variant_id: variantId,
        participant_count: participants, promo_code: null, use_credit: false,
        benefit: benefit || null, start_time: startTime || null, addons: addonKey ? addonKey.split(',') : [],
      }).then((r) => { if (!off) { setLines(r.data.data.lines); setTotal(r.data.data.total); } })
        .catch(() => { if (!off) { setLines(null); setFailed(true); } });
    }, 250);
    return () => { off = true; window.clearTimeout(t); };
  }, [businessId, customerId, serviceId, variantId, participants, benefit?.kind, benefit?.source_id, benefit?.item_id, startTime, addonKey]);

  if (!serviceId || !variantId) return null;
  return (
    <div className="q-sec" aria-live="polite"><div className="q-sec-h">{t('price.title')}</div><div className="q-sec-b">
      {failed ? <p className="mk-warn">{t('price.failed')}</p> : !lines ? <p className="mk-hint">{t('price.working')}</p> : (
        <>
          <div className="pay-lines">
            {lines.map((l, i) => <div key={i} className={`pay-line${i && l.amount < 0 ? ' sub' : ''}`}><span>{l.label}</span><b>{(l.amount < 0 ? '−' : '') + formatCurrency(Math.abs(l.amount))}</b></div>)}
            <div className="pay-line tot"><span>{t('price.total')}</span><b>{formatCurrency(total)}</b></div>
          </div>
          {benefit
            ? <p className="mk-hint">{t('price.benefitNote')}</p>
            : rule && <p className="mk-hint">{t(WHEN[rule])}</p>}
        </>
      )}
    </div></div>
  );
}
