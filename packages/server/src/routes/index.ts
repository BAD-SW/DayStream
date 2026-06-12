import { Router } from 'express';
import { healthRouter } from './health';
import { authRouter } from './auth';
import { adminRouter } from './admin';
import { profileRouter } from './profile';
import { usersRouter } from './users';
import { authLimiter } from '../middleware/rate-limit';

export const router = Router();

// Health check (unversioned — always available, no rate limit)
router.use('/health', healthRouter);

// Versioned routes
router.use('/v1/auth', authLimiter, authRouter);
router.use('/v1/admin', adminRouter);
router.use('/v1/profile', profileRouter);
router.use('/v1/users', usersRouter);
