import { Router } from 'express';
import { healthRouter } from './health';
import { authRouter } from './auth';
import { adminRouter } from './admin';
import { systemConfigRouter } from './system-config';
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
import { staffRouter } from './staff';
import { resourcesRouter } from './resources';
import { queryEditorRouter } from './query-editor';
import { eventsRouter } from './events';
import { checkInRouter } from './check-in';
import { marketingRouter } from './marketing';
import { reportsRouter } from './reports';
import { cmsRouter } from './cms';
import { integrationsRouter } from './integrations';
import { communityRouter } from './community';
import { authLimiter } from '../middleware/rate-limit';

export const router = Router();

// Health check (unversioned — always available, no rate limit)
router.use('/health', healthRouter);

// Versioned routes
router.use('/v1/auth', authLimiter, authRouter);
router.use('/v1/admin', adminRouter);
router.use('/v1/admin/system-config', systemConfigRouter);
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
router.use('/v1/staff', staffRouter);
router.use('/v1/resources', resourcesRouter);
router.use('/v1/events', eventsRouter);
router.use('/v1/check-in', checkInRouter);
router.use('/v1/marketing', marketingRouter);
router.use('/v1/reports', reportsRouter);
router.use('/v1/cms', cmsRouter);
router.use('/v1/integrations', integrationsRouter);
router.use('/v1/community', communityRouter);

// Query Editor (authentication and authorization handled within the router)
router.use('/v1/query-editor', queryEditorRouter);
