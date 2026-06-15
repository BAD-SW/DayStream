import { Router } from 'express';
import { healthRouter } from './health';
import { authRouter } from './auth';
import { adminRouter } from './admin';
import { profileRouter } from './profile';
import { usersRouter } from './users';
import { customersRouter } from './customers';
import { segmentsRouter } from './segments';
import { customerPortalRouter } from './customer-portal';
import { servicesRouter } from './services';
import { catalogRouter } from './catalog';
import { bookingsRouter } from './bookings';
import { membershipsRouter } from './memberships';
import { pricingRouter } from './pricing';
import { payrollRouter } from './payroll';
import { apRouter } from './accounts-payable';
import { authLimiter } from '../middleware/rate-limit';

export const router = Router();

// Health check (unversioned — always available, no rate limit)
router.use('/health', healthRouter);

// Versioned routes
router.use('/v1/auth', authLimiter, authRouter);
router.use('/v1/admin', adminRouter);
router.use('/v1/profile', profileRouter);
router.use('/v1/profile/customer', customerPortalRouter);
router.use('/v1/users', usersRouter);
router.use('/v1/customers', customersRouter);
router.use('/v1/segments', segmentsRouter);
router.use('/v1/services', servicesRouter);
router.use('/v1/catalog', catalogRouter);
router.use('/v1/bookings', bookingsRouter);
router.use('/v1/memberships', membershipsRouter);
router.use('/v1/pricing', pricingRouter);
router.use('/v1/payroll', payrollRouter);
router.use('/v1/ap', apRouter);
