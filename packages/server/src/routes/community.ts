import { Router, Request, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';
import * as feedService from '../services/community-feed.service';
import * as challengeService from '../services/community-challenges.service';
import * as pointsService from '../services/community-points.service';
import * as badgesService from '../services/community-badges.service';
import * as streaksService from '../services/community-streaks.service';
import * as vodService from '../services/community-vod.service';
import * as coursesService from '../services/community-courses.service';
import * as reviewsService from '../services/community-reviews.service';

export const communityRouter = Router();
communityRouter.use(authenticate);
communityRouter.use(tenantContext);

/**
 * Reactions and reviews are stored against a customer record (cus_customers), but the
 * caller is a login (usr_users) — the two ids are different, so passing the login id
 * broke the foreign key and every reaction / review failed. A login is matched to its
 * customer record by email within the tenant.
 */
async function customerIdFor(a: AuthenticatedRequest): Promise<string | null> {
  const { rows } = await adminPool.query(
    `SELECT c.id FROM cus_customers c
       JOIN usr_users u ON LOWER(u.email) = LOWER(c.email)
      WHERE u.id = $1 AND c.tenant_id = $2
      ORDER BY c.created_at ASC LIMIT 1`,
    [a.user.sub, a.tenantId],
  );
  return rows[0]?.id ?? null;
}

// --- Feed ---
communityRouter.get('/feed', async (req: Request, res: Response) => {
  try { const a = req as AuthenticatedRequest; const page = parseInt(req.query.page as string) || 1; success(res, await feedService.getFeed(a.tenantId, page)); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
communityRouter.post('/posts', async (req: Request, res: Response) => {
  try { const a = req as AuthenticatedRequest; const p = await feedService.createPost(a.tenantId, { authorId: a.user.sub, authorType: 'customer', postType: req.body.post_type || 'text', content: req.body.content, imagePath: req.body.image_path }); success(res, p, undefined, 201); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
communityRouter.post('/posts/:id/react', async (req: Request, res: Response) => {
  try { const a = req as AuthenticatedRequest; const customerId = await customerIdFor(a); if (!customerId) { error(res, 'No customer profile for this login', 'NO_CUSTOMER_PROFILE', 403); return; } success(res, await feedService.reactToPost(req.params.id, customerId, req.body.reaction_type || 'like')); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
communityRouter.post('/posts/:id/comments', async (req: Request, res: Response) => {
  try { const a = req as AuthenticatedRequest; const c = await feedService.addComment(req.params.id, { authorId: a.user.sub, authorType: 'customer', content: req.body.content }); success(res, c, undefined, 201); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
communityRouter.delete('/posts/:id', requirePermission('community:*'), async (req: Request, res: Response) => {
  try { const a = req as AuthenticatedRequest; await feedService.deletePost(req.params.id, a.tenantId); success(res, { deleted: true }); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Challenges ---
communityRouter.get('/challenges', async (req: Request, res: Response) => {
  try { const a = req as AuthenticatedRequest; success(res, await challengeService.getChallenges(a.tenantId, req.query.status as string)); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
communityRouter.post('/challenges', requirePermission('community:*'), async (req: Request, res: Response) => {
  try { const a = req as AuthenticatedRequest; const c = await challengeService.createChallenge(a.tenantId, req.body); success(res, c, undefined, 201); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
communityRouter.post('/challenges/:id/join', async (req: Request, res: Response) => {
  try { const a = req as AuthenticatedRequest; const customerId = await customerIdFor(a); if (!customerId) { error(res, 'No customer profile for this login', 'NO_CUSTOMER_PROFILE', 403); return; } const p = await challengeService.joinChallenge(req.params.id, customerId, req.body.goal_target || 10); success(res, p, undefined, 201); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
communityRouter.get('/challenges/:id/leaderboard', async (req: Request, res: Response) => {
  try { success(res, await challengeService.getChallengeLeaderboard(req.params.id)); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
communityRouter.get('/challenges/my', async (req: Request, res: Response) => {
  try { const a = req as AuthenticatedRequest; const customerId = await customerIdFor(a); if (!customerId) { success(res, []); return; } success(res, await challengeService.getMyActiveChallenges(a.tenantId, customerId)); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Points ---
communityRouter.get('/points', async (req: Request, res: Response) => {
  try { const a = req as AuthenticatedRequest; const customerId = await customerIdFor(a); if (!customerId) { success(res, { balance: 0, history: [] }); return; } const balance = await pointsService.getBalance(a.tenantId, customerId); const history = await pointsService.getHistory(a.tenantId, customerId); success(res, { balance, history }); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
communityRouter.post('/rewards/redeem', async (req: Request, res: Response) => {
  try { const a = req as AuthenticatedRequest; const customerId = await customerIdFor(a); if (!customerId) { error(res, 'No customer profile for this login', 'NO_CUSTOMER_PROFILE', 403); return; } const r = await pointsService.redeemPoints(a.tenantId, customerId, req.body.points, req.body.description); success(res, r); } catch (e: any) { error(res, e.message || 'Failed', 'VALIDATION_ERROR', 400); }
});

// --- Badges ---
communityRouter.get('/badges', async (req: Request, res: Response) => {
  try { const a = req as AuthenticatedRequest; success(res, await badgesService.getBadges(a.tenantId)); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
communityRouter.get('/badges/my', async (req: Request, res: Response) => {
  try { const a = req as AuthenticatedRequest; const customerId = await customerIdFor(a); if (!customerId) { success(res, []); return; } success(res, await badgesService.getEarnedBadges(customerId)); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Streaks ---
communityRouter.get('/streaks', async (req: Request, res: Response) => {
  try { const a = req as AuthenticatedRequest; const customerId = await customerIdFor(a); if (!customerId) { success(res, null); return; } success(res, await streaksService.getStreak(a.tenantId, customerId)); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Leaderboard ---
communityRouter.get('/leaderboard', async (req: Request, res: Response) => {
  try { const a = req as AuthenticatedRequest; const type = req.query.type as string || 'points'; if (type === 'points') { const { rows } = await (await import('../db/pool')).adminPool.query(`SELECT customer_id, SUM(points)::int AS total_points FROM eng_customer_points WHERE tenant_id = $1 AND (expires_at IS NULL OR expires_at > NOW()) GROUP BY customer_id ORDER BY total_points DESC LIMIT 10`, [a.tenantId]); success(res, rows); } else { success(res, []); } } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- VOD ---
communityRouter.get('/vod', async (req: Request, res: Response) => {
  try { const a = req as AuthenticatedRequest; success(res, await vodService.getLibrary(a.tenantId, { category: req.query.category as string, difficulty: req.query.difficulty as string })); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
communityRouter.get('/vod/:id', async (req: Request, res: Response) => {
  try { const v = await vodService.getContent(req.params.id); if (!v) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, v); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
communityRouter.put('/vod/:id/progress', async (req: Request, res: Response) => {
  try { const a = req as AuthenticatedRequest; const customerId = await customerIdFor(a); if (!customerId) { error(res, 'No customer profile for this login', 'NO_CUSTOMER_PROFILE', 403); return; } const p = await vodService.updateProgress(customerId, req.params.id, req.body.watched_seconds, req.body.completed); success(res, p); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
communityRouter.post('/vod', requirePermission('community:*'), async (req: Request, res: Response) => {
  try { const a = req as AuthenticatedRequest; const v = await vodService.createContent(a.tenantId, req.body); success(res, v, undefined, 201); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Courses ---
communityRouter.get('/courses', async (req: Request, res: Response) => {
  try { const a = req as AuthenticatedRequest; success(res, await coursesService.getCourses(a.tenantId)); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
communityRouter.get('/courses/:id', async (req: Request, res: Response) => {
  try { const c = await coursesService.getCourseDetail(req.params.id); if (!c) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, c); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
communityRouter.post('/courses/:id/enroll', async (req: Request, res: Response) => {
  try { const a = req as AuthenticatedRequest; const customerId = await customerIdFor(a); if (!customerId) { error(res, 'No customer profile for this login', 'NO_CUSTOMER_PROFILE', 403); return; } const e2 = await coursesService.enrollInCourse(req.params.id, customerId); success(res, e2, undefined, 201); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
communityRouter.put('/courses/:id/lessons/:lid/complete', async (req: Request, res: Response) => {
  try { const r = await coursesService.completeLesson(req.body.enrollment_id, req.params.lid); success(res, r); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Reviews ---
communityRouter.post('/reviews', async (req: Request, res: Response) => {
  try { const a = req as AuthenticatedRequest; const customerId = await customerIdFor(a); if (!customerId) { error(res, 'No customer profile for this login', 'NO_CUSTOMER_PROFILE', 403); return; } const r = await reviewsService.submitReview(a.tenantId, { ...req.body, customerId }); success(res, r, undefined, 201); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
communityRouter.get('/reviews/service/:sid', async (req: Request, res: Response) => {
  try { success(res, await reviewsService.getServiceReviews(req.params.sid, req.query.status as string)); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
communityRouter.put('/reviews/:id/respond', requirePermission('community:*'), async (req: Request, res: Response) => {
  try { const a = req as AuthenticatedRequest; const r = await reviewsService.respondToReview(req.params.id, a.tenantId, req.body.response); success(res, r); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
communityRouter.put('/reviews/:id/moderate', requirePermission('community:*'), async (req: Request, res: Response) => {
  try { const a = req as AuthenticatedRequest; const r = await reviewsService.moderateReview(req.params.id, a.tenantId, req.body.status); success(res, r); } catch (e: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
