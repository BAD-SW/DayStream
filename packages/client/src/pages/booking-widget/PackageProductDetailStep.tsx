import { useTranslation } from 'react-i18next';
import { WidgetProductDetail } from '../../api/widget';
import { formatMoney } from './format';

interface Props {
  product: WidgetProductDetail;
  onContinue: () => void;
}

/** Requirement 18.1 — package/membership product detail: no variant picker (single
 * price, no duration), items included instead of a service's booking_type. */
export function PackageProductDetailStep({ product, onContinue }: Props) {
  const { t } = useTranslation('widget');
  const isMembership = product.product_type === 'membership';

  return (
    <div className="dsw-step">
      <h2 className="dsw-step-title">{product.name}</h2>
      {product.description && <p className="dsw-step-text" style={{ whiteSpace: 'pre-line' }}>{product.description}</p>}

      {product.items && product.items.length > 0 && (
        <ul className="dsw-items-list">
          {product.items.map((item, i) => (
            <li key={i}>
              {t(isMembership ? 'package.perPeriod' : 'package.item', { quantity: item.quantity || item.quantity_per_period, name: item.service_name || item.item_type })}
            </li>
          ))}
        </ul>
      )}

      <div className="dsw-variant-single">
        <span>{isMembership ? t('package.billed', { frequency: t(`frequency.${product.billing_frequency}`, { defaultValue: product.billing_frequency }) }) : product.expiration_type && product.expiration_type !== 'none' ? t('package.expires', { count: product.expiration_days }) : t('package.noExpiration')}</span>
        <span className="dsw-price">{formatMoney(product.price ?? 0)}</span>
      </div>

      <button className="dsw-btn dsw-btn--primary" onClick={onContinue}>{t('package.continue')}</button>
    </div>
  );
}
