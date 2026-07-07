import { adminPool } from '../db/pool';
import crypto from 'crypto';

// Placeholder OAuth provider configurations
const OAUTH_PROVIDERS: Record<string, { authUrl: string; tokenUrl: string; scopes: string[] }> = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/calendar'],
  },
  microsoft: {
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['Calendars.ReadWrite'],
  },
};

/**
 * Initiate an OAuth flow — generates a state token and returns the authorization URL.
 */
export async function initiateOAuth(tenantId: string, provider: string, redirectUri: string) {
  const providerConfig = OAUTH_PROVIDERS[provider];
  if (!providerConfig) throw new Error(`Unsupported OAuth provider: ${provider}`);

  const state = crypto.randomBytes(32).toString('hex');

  // Store state temporarily in a pending connection
  await adminPool.query(
    `INSERT INTO int_connections (tenant_id, integration_type, provider, status, config)
     VALUES ($1, 'oauth', $2, 'disconnected', $3)`,
    [tenantId, provider, JSON.stringify({ state, redirectUri })],
  );

  const params = new URLSearchParams({
    response_type: 'code',
    scope: providerConfig.scopes.join(' '),
    state,
    redirect_uri: redirectUri,
    // client_id would come from env config in production
    client_id: 'PLACEHOLDER_CLIENT_ID',
  });

  return {
    authorizationUrl: `${providerConfig.authUrl}?${params.toString()}`,
    state,
  };
}

/**
 * Handle the OAuth callback — exchanges authorization code for tokens.
 */
export async function handleCallback(state: string, code: string) {
  // Find the pending connection by state
  const { rows } = await adminPool.query(
    `SELECT * FROM int_connections
     WHERE status = 'disconnected' AND config->>'state' = $1`,
    [state],
  );
  if (rows.length === 0) throw new Error('Invalid or expired OAuth state');

  const connection = rows[0];
  const provider = connection.provider;
  const providerConfig = OAUTH_PROVIDERS[provider];
  if (!providerConfig) throw new Error(`Unsupported provider: ${provider}`);

  // Placeholder: In production, exchange code for tokens via HTTP POST to tokenUrl
  const tokens = {
    access_token: `placeholder_access_token_${crypto.randomBytes(16).toString('hex')}`,
    refresh_token: `placeholder_refresh_token_${crypto.randomBytes(16).toString('hex')}`,
    expires_in: 3600,
  };

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await adminPool.query(
    `UPDATE int_connections
     SET status = 'connected', oauth_access_token = $1, oauth_refresh_token = $2,
         oauth_expires_at = $3, config = config - 'state', updated_at = NOW()
     WHERE id = $4`,
    [tokens.access_token, tokens.refresh_token, expiresAt.toISOString(), connection.id],
  );

  return { connectionId: connection.id, provider, status: 'connected' };
}

/**
 * Refresh an expired OAuth token.
 */
export async function refreshToken(connectionId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM int_connections WHERE id = $1`,
    [connectionId],
  );
  if (rows.length === 0) throw new Error('Connection not found');

  const connection = rows[0];
  const providerConfig = OAUTH_PROVIDERS[connection.provider];
  if (!providerConfig) throw new Error(`Unsupported provider: ${connection.provider}`);

  // Placeholder: In production, POST to tokenUrl with refresh_token grant
  const newTokens = {
    access_token: `placeholder_refreshed_token_${crypto.randomBytes(16).toString('hex')}`,
    expires_in: 3600,
  };

  const expiresAt = new Date(Date.now() + newTokens.expires_in * 1000);

  await adminPool.query(
    `UPDATE int_connections
     SET oauth_access_token = $1, oauth_expires_at = $2, status = 'connected', updated_at = NOW()
     WHERE id = $3`,
    [newTokens.access_token, expiresAt.toISOString(), connectionId],
  );

  return { connectionId, status: 'connected', expiresAt };
}
