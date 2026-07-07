import { adminPool } from '../db/pool';

interface MarketplaceIntegration {
  id: string;
  name: string;
  provider: string;
  category: string;
  description: string;
}

const CATALOG: MarketplaceIntegration[] = [
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    provider: 'google',
    category: 'calendar',
    description: 'Sync bookings with Google Calendar for staff and customers.',
  },
  {
    id: 'microsoft-outlook',
    name: 'Microsoft Outlook',
    provider: 'microsoft',
    category: 'calendar',
    description: 'Sync bookings with Outlook Calendar.',
  },
  {
    id: 'stripe-payments',
    name: 'Stripe',
    provider: 'stripe',
    category: 'payments',
    description: 'Process payments and manage subscriptions via Stripe.',
  },
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    provider: 'mailchimp',
    category: 'marketing',
    description: 'Sync customer lists and trigger email campaigns.',
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks Online',
    provider: 'quickbooks',
    category: 'accounting',
    description: 'Sync invoices and payments with QuickBooks.',
  },
  {
    id: 'xero',
    name: 'Xero',
    provider: 'xero',
    category: 'accounting',
    description: 'Sync financial data with Xero accounting.',
  },
];

/**
 * Get the static marketplace catalog of available integrations.
 */
export function getMarketplaceCatalog() {
  return CATALOG;
}

/**
 * Get marketplace catalog enriched with connection status for a tenant.
 */
export async function getMarketplaceWithStatus(tenantId: string) {
  const { rows: connections } = await adminPool.query(
    `SELECT provider, status FROM int_connections WHERE tenant_id = $1`,
    [tenantId],
  );

  const statusMap = new Map<string, string>();
  for (const conn of connections) {
    statusMap.set(conn.provider, conn.status);
  }

  return CATALOG.map((item) => ({
    ...item,
    connectionStatus: statusMap.get(item.provider) || 'not_connected',
  }));
}
