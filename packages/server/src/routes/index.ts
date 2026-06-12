import { Router } from 'express';
import { healthRouter } from './health';

export const router = Router();

// Health check (unversioned — always available)
router.use('/health', healthRouter);

// Versioned routes
// router.use('/v1/...', ...);
