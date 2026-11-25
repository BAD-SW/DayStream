import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WidgetProductDetail } from '../../api/widget';
import { formatDuration, formatMoney } from './format';

interface Props {
  product: WidgetProductDetail;
  selectedVariantId: string | null;
  /** The add-ons chosen before (when coming back to this step). */
  selectedAddonIds: string[];
  onContinue: (variantId: string, addonIds: string[]) => void;
}

export function ProductDetailStep({ product, selectedVariantId, selectedAddonIds, onContinue }: Props) {
  const { t } = useTranslation('widget');
  const variants = product.variants || []; // always present for a service, per the widget API contract
  const addons = product.addons || [];
  const [variantId, setVariantId] = useState<string>(selectedVariantId || variants[0]?.id || '');
  const [addonIds, setAddonIds] = useState<string[]>(selectedAddonIds.filter((id) => addons.some((a) => a.id === id)));
  const toggle = (id: string) => setAddonIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <div className="dsw-step">
      <h2 className="dsw-step-title">{product.name}</h2>
      {product.description && <p className="dsw-step-text">{product.description}</p>}

      {variants.length > 1 ? (
        <div className="dsw-variant-list">
          {variants.map((v) => (
            <label key={v.id} className={`dsw-variant-option ${variantId === v.id ? 'dsw-variant-option--selected' : ''}`}>
              <input
                type="radio"
                name="variant"
                value={v.id}
                checked={variantId === v.id}
                onChange={() => setVariantId(v.id)}
              />
              <span className="dsw-variant-name">{v.name}</span>
              <span className="dsw-variant-meta">{t('product.optionMeta', { duration: formatDuration(v.duration), price: formatMoney(v.price) })}</span>
            </label>
          ))}
        </div>
      ) : variants[0] ? (
        <div className="dsw-variant-single">
          <span>{formatDuration(variants[0].duration)}</span>
          <span className="dsw-price">{formatMoney(variants[0].price)}</span>
        </div>
      ) : null}

      {/* Add-ons (spec 51, gap 15): extras with the service, each with its price; they add no time */}
      {addons.length > 0 && (
        <fieldset className="dsw-variant-list" style={{ border: 'none', padding: 0, margin: 0, minWidth: 0 }}>
          <legend className="dsw-step-text">{t('product.addons')}</legend>
          {addons.map((a) => (
            <label key={a.id} className={`dsw-variant-option ${addonIds.includes(a.id) ? 'dsw-variant-option--selected' : ''}`}>
              <input type="checkbox" name="addon" value={a.id} checked={addonIds.includes(a.id)} onChange={() => toggle(a.id)} />
              <span className="dsw-variant-name">{a.name}{a.description && <small className="dsw-variant-meta"> {a.description}</small>}</span>
              <span className="dsw-variant-meta">+ {formatMoney(a.price)}</span>
            </label>
          ))}
        </fieldset>
      )}

      <button
        className="dsw-btn dsw-btn--primary"
        disabled={!variantId}
        onClick={() => onContinue(variantId, addonIds)}
      >
        {t('product.continue')}
      </button>
    </div>
  );
}
