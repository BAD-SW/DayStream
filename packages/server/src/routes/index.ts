import { Router } from 'express';
import { healthRouter } from './health';
import { authRouter } from './auth';
import { authLimiter } from '../middleware/rate-limit';

export const router = Router();

// Health check (unversioned — always available)
router.use('/health', healthRouter);

// Versioned routes
router.use('/v1/auth', authLimiter, authRouter);
