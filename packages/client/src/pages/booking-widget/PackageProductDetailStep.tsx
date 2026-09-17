import { WidgetProductDetail } from '../../api/widget';
import { formatMoney } from './format';

interface Props {
  product: WidgetProductDetail;
  onContinue: () => void;
}

/** Requirement 18.1 — package/membership product detail: no variant picker (single
 * price, no duration), items included instead of a service's booking_type. */
export function PackageProductDetailStep({ product, onContinue }: Props) {
  const isMembership = product.product_type === 'membership';

  return (
    <div className="dsw-step">
      <h2 className="dsw-step-title">{product.name}</h2>
      {product.description && <p className="dsw-step-text" style={{ whiteSpace: 'pre-line' }}>{product.description}</p>}

      {product.items && product.items.length > 0 && (
        <ul className="dsw-items-list">
          {product.items.map((item, i) => (
            <li key={i}>
              {item.quantity || item.quantity_per_period}× {item.service_name || item.item_type}
              {isMembership ? ' per period' : ''}
            </li>
          ))}
        </ul>
      )}

      <div className="dsw-variant-single">
        <span>{isMembership ? `Billed ${product.billing_frequency}` : product.expiration_type && product.expiration_type !== 'none' ? `Expires in ${product.expiration_days} days` : 'No expiration'}</span>
        <span className="dsw-price">{formatMoney(product.price ?? 0)}</span>
      </div>

      <button className="dsw-btn dsw-btn--primary" onClick={onContinue}>Continue</button>
    </div>
  );
}
