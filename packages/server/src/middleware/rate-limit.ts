import rateLimit from 'express-rate-limit';

/**
 * Strict rate limit for authentication endpoints.
 * 10 requests per minute per IP.
 */
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts. Please try again later.', code: 'RATE_LIMITED' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Moderate rate limit for general API endpoints.
 * 1000 requests per hour per IP/user.
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 1000,
  message: { error: 'Rate limit exceeded. Please try again later.', code: 'RATE_LIMITED' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Public forms (website contact form): a visitor sends a handful, a script sends hundreds.
 * 8 submissions per minute per IP.
 */
export const publicFormLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 8,
  message: { error: 'Too many submissions. Please try again in a minute.', code: 'RATE_LIMITED' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Self check-in (the kiosk and a customer's phone). Many people share a clinic's wifi address, so
 * this is more generous than a contact form: 60 requests a minute per address.
 */
export const selfCheckInLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many attempts. Please wait a minute and try again.', code: 'RATE_LIMITED' },
  standardHeaders: true,
  legacyHeaders: false,
});
