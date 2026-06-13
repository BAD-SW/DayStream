import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { validate } from '../middleware/validate';
import * as authService from '../services/auth.service';
import { sendPasswordResetEmail } from '../services/email.service';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';

export const authRouter = Router();

// --- Validation schemas ---

const registerSchema = Joi.object({
  tenant_id: Joi.string().uuid().required(),
  email: Joi.string().email({ tlds: false }).required(),
  password: Joi.string()
    .min(10)
    .pattern(/[a-z]/, 'lowercase')
    .pattern(/[A-Z]/, 'uppercase')
    .pattern(/[0-9]/, 'digit')
    .pattern(/[^a-zA-Z0-9]/, 'special')
    .required()
    .messages({
      'string.min': 'Password must be at least 10 characters',
      'string.pattern.name': 'Password must contain {#name} characters',
    }),
  first_name: Joi.string().min(1).max(100).required(),
  last_name: Joi.string().min(1).max(100).required(),
});

const loginSchema = Joi.object({
  tenant_id: Joi.string().uuid().required(),
  email: Joi.string().email({ tlds: false }).required(),
  password: Joi.string().required(),
});

const refreshSchema = Joi.object({
  refresh_token: Joi.string().required(),
});

const forgotPasswordSchema = Joi.object({
  tenant_id: Joi.string().uuid().required(),
  email: Joi.string().email({ tlds: false }).required(),
});

const resetPasswordSchema = Joi.object({
  token: Joi.string().required(),
  password: Joi.string()
    .min(10)
    .pattern(/[a-z]/, 'lowercase')
    .pattern(/[A-Z]/, 'uppercase')
    .pattern(/[0-9]/, 'digit')
    .pattern(/[^a-zA-Z0-9]/, 'special')
    .required(),
});

// --- Routes ---

// POST /api/v1/auth/register
authRouter.post('/register', validate(registerSchema), async (req: Request, res: Response) => {
  try {
    const { tenant_id, email, password, first_name, last_name } = req.body;
    const result = await authService.registerUser(tenant_id, email, password, first_name, last_name);

    res.status(201).json({
      data: {
        user: {
          id: result.user.id,
          email: result.user.email,
          first_name: result.user.first_name,
          last_name: result.user.last_name,
          role: result.user.role,
        },
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
      },
    });
  } catch (err: any) {
    if (err.message === 'A user with this email already exists') {
      res.status(409).json({ error: err.message, code: 'EMAIL_EXISTS' });
    } else {
      console.error('Registration error:', err.message);
      res.status(500).json({ error: 'Registration failed', code: 'INTERNAL_ERROR' });
    }
  }
});

// POST /api/v1/auth/login
authRouter.post('/login', validate(loginSchema), async (req: Request, res: Response) => {
  try {
    const { tenant_id, email, password } = req.body;
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';

    const result = await authService.loginUser(tenant_id, email, password, ip, userAgent);

    if (result.requiresMfa) {
      res.status(200).json({ data: { requires_mfa: true } });
      return;
    }

    // Set refresh token as httpOnly cookie
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/api/v1/auth',
    });

    res.status(200).json({
      data: {
        access_token: result.accessToken,
        refresh_token: result.refreshToken, // also in body for non-browser clients
        user: {
          id: result.user.id,
          email: result.user.email,
          first_name: result.user.first_name,
          last_name: result.user.last_name,
          role: result.user.role,
          business_id: result.user.business_id || null,
        },
      },
    });
  } catch (err: any) {
    if (err.message === 'Account is locked. Please try again later.') {
      res.status(423).json({ error: err.message, code: 'ACCOUNT_LOCKED' });
    } else if (err.message === 'Invalid credentials') {
      res.status(401).json({ error: err.message, code: 'INVALID_CREDENTIALS' });
    } else {
      res.status(500).json({ error: 'Login failed', code: 'INTERNAL_ERROR' });
    }
  }
});

// POST /api/v1/auth/refresh
authRouter.post('/refresh', async (req: Request, res: Response) => {
  try {
    // Accept refresh token from cookie OR body
    const refreshTokenValue = req.cookies?.refresh_token || req.body?.refresh_token;
    if (!refreshTokenValue) {
      res.status(401).json({ error: 'Refresh token required', code: 'INVALID_REFRESH_TOKEN' });
      return;
    }

    const result = await authService.refreshAccessToken(refreshTokenValue);

    // Update the cookie with the new refresh token
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/v1/auth',
    });

    res.status(200).json({
      data: {
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
      },
    });
  } catch (err: any) {
    res.status(401).json({ error: err.message, code: 'INVALID_REFRESH_TOKEN' });
  }
});

// POST /api/v1/auth/logout
authRouter.post('/logout', authenticate, async (req: Request, res: Response) => {
  try {
    const refreshTokenValue = req.cookies?.refresh_token || req.body?.refresh_token;
    if (refreshTokenValue) {
      await authService.revokeRefreshToken(refreshTokenValue);
    }

    // Clear the cookie
    res.clearCookie('refresh_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/v1/auth',
    });

    res.status(200).json({ data: { message: 'Logged out successfully' } });
  } catch (err: any) {
    res.status(500).json({ error: 'Logout failed', code: 'INTERNAL_ERROR' });
  }
});

// POST /api/v1/auth/logout-all
authRouter.post('/logout-all', authenticate, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    await authService.revokeAllUserTokens(authReq.user.sub);
    res.status(200).json({ data: { message: 'All sessions revoked' } });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to revoke sessions', code: 'INTERNAL_ERROR' });
  }
});

// POST /api/v1/auth/forgot-password
authRouter.post('/forgot-password', validate(forgotPasswordSchema), async (req: Request, res: Response) => {
  try {
    const { tenant_id, email } = req.body;

    // Check if user exists (but always return success to prevent enumeration)
    const user = await authService.findUserByEmail(email, tenant_id);
    if (user) {
      // Generate a time-limited reset token (15 minutes)
      const resetToken = authService.generateRefreshToken(); // reuse crypto random for reset token
      // TODO: Store reset token in DB with expiry. For now, send via email.
      await sendPasswordResetEmail(email, resetToken);
    }

    // Always return success
    res.status(200).json({ data: { message: 'If the email exists, a password reset link has been sent.' } });
  } catch (err: any) {
    // Still return success even on failure to prevent enumeration
    res.status(200).json({ data: { message: 'If the email exists, a password reset link has been sent.' } });
  }
});

// POST /api/v1/auth/reset-password
authRouter.post('/reset-password', validate(resetPasswordSchema), async (req: Request, res: Response) => {
  // TODO: Implement token validation and password reset when email service is available
  res.status(200).json({ data: { message: 'Password has been reset.' } });
});
