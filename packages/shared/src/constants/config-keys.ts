export const CONFIG_KEYS = {
  // Branding
  BRAND_PRIMARY_COLOR: 'brand.primary_color',
  BRAND_LOGO_URL: 'brand.logo_url',
  BRAND_BUSINESS_NAME: 'brand.business_name',

  // Features
  FEATURE_ONLINE_BOOKING: 'feature.online_booking',
  FEATURE_WAITLIST: 'feature.waitlist',
  FEATURE_MEMBERSHIPS: 'feature.memberships',

  // Limits
  LIMIT_MAX_ADVANCE_BOOKING_DAYS: 'limit.max_advance_booking_days',
  LIMIT_MAX_BOOKINGS_PER_CUSTOMER: 'limit.max_bookings_per_customer',
  LIMIT_SESSION_TIMEOUT_MINUTES: 'limit.session_timeout_minutes',

  // Integrations
  INTEGRATION_GOOGLE_CALENDAR: 'integration.google_calendar',
  INTEGRATION_SMS_NOTIFICATIONS: 'integration.sms_notifications',
} as const;
