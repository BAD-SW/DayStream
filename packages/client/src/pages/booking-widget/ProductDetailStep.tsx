import { useState } from 'react';
import { WidgetProductDetail } from '../../api/widget';
import { formatDuration, formatMoney } from './format';

interface Props {
  product: WidgetProductDetail;
  selectedVariantId: string | null;
  onContinue: (variantId: string) => void;
}

export function ProductDetailStep({ product, selectedVariantId, onContinue }: Props) {
  const variants = product.variants || []; // always present for a service, per the widget API contract
  const [variantId, setVariantId] = useState<string>(selectedVariantId || variants[0]?.id || '');

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
              <span className="dsw-variant-meta">{formatDuration(v.duration)} · {formatMoney(v.price)}</span>
            </label>
          ))}
        </div>
      ) : variants[0] ? (
        <div className="dsw-variant-single">
          <span>{formatDuration(variants[0].duration)}</span>
          <span className="dsw-price">{formatMoney(variants[0].price)}</span>
        </div>
      ) : null}

      <button
        className="dsw-btn dsw-btn--primary"
        disabled={!variantId}
        onClick={() => onContinue(variantId)}
      >
        Continue
      </button>
    </div>
  );
}
