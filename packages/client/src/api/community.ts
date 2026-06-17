import { apiClient } from './client';

export async function getFeed(page?: number) { const r = await apiClient.get('/v1/community/feed', { params: { page } }); return r.data.data; }
export async function createPost(data: Record<string, any>) { const r = await apiClient.post('/v1/community/posts', data); return r.data.data; }
export async function reactToPost(postId: string, type?: string) { const r = await apiClient.post(`/v1/community/posts/${postId}/react`, { reaction_type: type || 'like' }); return r.data.data; }
export async function addComment(postId: string, content: string) { const r = await apiClient.post(`/v1/community/posts/${postId}/comments`, { content }); return r.data.data; }
export async function getChallenges(status?: string) { const r = await apiClient.get('/v1/community/challenges', { params: { status } }); return r.data.data; }
export async function joinChallenge(id: string, goalTarget?: number) { const r = await apiClient.post(`/v1/community/challenges/${id}/join`, { goal_target: goalTarget }); return r.data.data; }
export async function getMyChallenges() { const r = await apiClient.get('/v1/community/challenges/my'); return r.data.data; }
export async function getPoints() { const r = await apiClient.get('/v1/community/points'); return r.data.data; }
export async function redeemPoints(points: number, desc?: string) { const r = await apiClient.post('/v1/community/rewards/redeem', { points, description: desc }); return r.data.data; }
export async function getBadges() { const r = await apiClient.get('/v1/community/badges'); return r.data.data; }
export async function getMyBadges() { const r = await apiClient.get('/v1/community/badges/my'); return r.data.data; }
export async function getStreak() { const r = await apiClient.get('/v1/community/streaks'); return r.data.data; }
export async function getLeaderboard(type?: string) { const r = await apiClient.get('/v1/community/leaderboard', { params: { type } }); return r.data.data; }
export async function getVodLibrary(params?: Record<string, any>) { const r = await apiClient.get('/v1/community/vod', { params }); return r.data.data; }
export async function getCourses() { const r = await apiClient.get('/v1/community/courses'); return r.data.data; }
export async function enrollInCourse(id: string) { const r = await apiClient.post(`/v1/community/courses/${id}/enroll`); return r.data.data; }
export async function submitReview(data: Record<string, any>) { const r = await apiClient.post('/v1/community/reviews', data); return r.data.data; }
