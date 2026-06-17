# Phase 22: Community & Engagement - Tasks

## Overview

Implementation tasks for the community and engagement module — database schema, community feed, challenges, gamification (points/badges/streaks/leaderboards), video-on-demand, online courses, referral program, reviews, and mobile integration.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 1. Database Schema

### 1.1 Core Tables
- [x] ✅ Create migration for community tables (posts, reactions, comments)
- [x] ✅ Create migration for challenge tables (challenges, participants)
- [x] ✅ Create migration for gamification tables (points, badges, customer_badges, streaks)
- [x] ✅ Create migration for VOD tables (content, progress)
- [x] ✅ Create migration for course tables (courses, lessons, enrollments, lesson_progress)
- [x] ✅ Create migration for referral tables (codes, referrals)
- [x] ✅ Create migration for reviews table

### 1.2 Indexes and Permissions
- [x] ✅ Add indexes (tenant, customer, dates, foreign keys)
- [x] ✅ Add RLS policies on all tables (tenant-scoped)
- [x] ✅ Grant permissions to daystream_app role
- [x] ✅ Run migrations and verify schema

---

## 2. Community Feed

### 2.1 Feed Service
- [x] ✅ Create `community-feed.service.ts`
- [x] ✅ Support creating posts (text, image, system-generated)
- [x] ✅ Support reactions (like, celebrate, motivate — per post per customer)
- [x] ✅ Support comments (text, deletable)
- [x] ✅ Support moderation (delete post, profanity filter)
- [x] ✅ Feed pagination (reverse chronological)
- [x] ✅ Auto-generate posts for achievements/milestones
- [x] ✅ Write tests

### 2.2 Routes
- [x] ✅ Create `GET /api/v1/community/feed` endpoint
- [x] ✅ Create `POST /api/v1/community/posts` endpoint
- [x] ✅ Create `POST /api/v1/community/posts/:id/react` endpoint
- [x] ✅ Create `POST /api/v1/community/posts/:id/comments` endpoint
- [x] ✅ Create `DELETE /api/v1/community/posts/:id` endpoint

---

## 3. Challenges

### 3.1 Challenge Service
- [x] ✅ Create `community-challenges.service.ts`
- [x] ✅ Support challenge CRUD (create, list active, get detail)
- [x] ✅ Support joining challenges (with capacity check)
- [x] ✅ Track progress automatically from check-in/booking events
- [x] ✅ Evaluate progress on each relevant event
- [x] ✅ Mark completed, award rewards, post to feed
- [x] ✅ Support challenge leaderboard (participants ranked by progress)
- [x] ✅ Support recurring challenges (monthly reset)
- [x] ✅ Write tests

### 3.2 Routes
- [x] ✅ Create `GET /api/v1/community/challenges` endpoint
- [x] ✅ Create `POST /api/v1/community/challenges` endpoint (admin)
- [x] ✅ Create `POST /api/v1/community/challenges/:id/join` endpoint
- [x] ✅ Create `GET /api/v1/community/challenges/:id/leaderboard` endpoint
- [x] ✅ Create `GET /api/v1/community/challenges/my` endpoint

---

## 4. Points & Rewards

### 4.1 Points Service
- [x] ✅ Create `community-points.service.ts`
- [x] ✅ Award points on configurable events (check-in, booking, referral, etc.)
- [x] ✅ Track points balance per customer
- [x] ✅ Track points history (earned, spent, expired)
- [x] ✅ Support points expiration (configurable)
- [x] ✅ Support points redemption from rewards catalog
- [x] ✅ Prevent negative balance
- [x] ✅ Write tests

### 4.2 Rewards Catalog
- [x] ✅ Support configuring redeemable rewards (discount, free session, etc.)
- [x] ✅ Support redemption (deduct points, issue reward)
- [x] ✅ Write tests

### 4.3 Routes
- [x] ✅ Create `GET /api/v1/community/points` endpoint
- [x] ✅ Create `GET /api/v1/community/rewards` endpoint
- [x] ✅ Create `POST /api/v1/community/rewards/redeem` endpoint

---

## 5. Badges & Achievements

### 5.1 Badge Service
- [x] ✅ Create `community-badges.service.ts`
- [x] ✅ Support configurable badges per tenant (trigger type + config)
- [x] ✅ Evaluate badge criteria on events (visit count, streak, challenge, etc.)
- [x] ✅ Award badge automatically when criteria met
- [x] ✅ Support badge tiers (bronze/silver/gold)
- [x] ✅ Announce in feed (opt-in)
- [x] ✅ Write tests

### 5.2 Routes
- [x] ✅ Create `GET /api/v1/community/badges` endpoint (available badges)
- [x] ✅ Create `GET /api/v1/community/badges/my` endpoint (earned)

---

## 6. Streaks

### 6.1 Streak Service
- [x] ✅ Create `community-streaks.service.ts`
- [x] ✅ Track weekly attendance streaks per customer
- [x] ✅ Update on check-in (recalculate current streak)
- [x] ✅ Track longest streak ever
- [x] ✅ Award points/badges at milestones (4, 8, 12, 26, 52 weeks)
- [x] ✅ Send streak-at-risk notification (Sunday without visit)
- [x] ✅ Support streak freeze (1 free pass per month)
- [x] ✅ Write tests

### 6.2 Routes
- [x] ✅ Create `GET /api/v1/community/streaks` endpoint

---

## 7. Leaderboards

### 7.1 Leaderboard Service
- [x] ✅ Create `community-leaderboards.service.ts`
- [x] ✅ Support leaderboard types (points, streaks, visits)
- [x] ✅ Monthly reset for time-based boards
- [x] ✅ Display top N + current customer's rank
- [x] ✅ Support opt-out (hide from rankings)
- [x] ✅ Use display names for privacy
- [x] ✅ Write tests

### 7.2 Routes
- [x] ✅ Create `GET /api/v1/community/leaderboard` endpoint (type param)

---

## 8. Video-on-Demand

### 8.1 VOD Service
- [x] ✅ Create `community-vod.service.ts`
- [x] ✅ Support video CRUD (upload metadata, manage catalog)
- [x] ✅ Support categories, tags, difficulty, instructor
- [x] ✅ Support access gating (free, members, plan-specific)
- [x] ✅ Track viewing progress per customer (watched seconds, completed)
- [x] ✅ Award points on completion
- [x] ✅ Write tests

### 8.2 Routes
- [x] ✅ Create `GET /api/v1/community/vod` endpoint (library)
- [x] ✅ Create `GET /api/v1/community/vod/:id` endpoint (detail + progress)
- [x] ✅ Create `PUT /api/v1/community/vod/:id/progress` endpoint
- [x] ✅ Create `POST /api/v1/community/vod` endpoint (admin upload)

---

## 9. Online Courses

### 9.1 Course Service
- [x] ✅ Create `community-courses.service.ts`
- [x] ✅ Support course CRUD (title, description, instructor, access)
- [x] ✅ Support lesson management (modules, order, content types)
- [x] ✅ Support enrollment (free or paid)
- [x] ✅ Track progress (lessons completed / total)
- [x] ✅ Mark lessons complete
- [x] ✅ Award points/badges on course completion
- [x] ✅ Generate completion certificate (PDF)
- [x] ✅ Support prerequisites
- [x] ✅ Write tests

### 9.2 Routes
- [x] ✅ Create `GET /api/v1/community/courses` endpoint
- [x] ✅ Create `GET /api/v1/community/courses/:id` endpoint (detail + lessons)
- [x] ✅ Create `POST /api/v1/community/courses/:id/enroll` endpoint
- [x] ✅ Create `PUT /api/v1/community/courses/:id/lessons/:lid/complete` endpoint

---

## 10. Referral Program

### 10.1 Referral Service
- [x] ✅ Create `community-referrals.service.ts`
- [x] ✅ Generate unique referral code per customer
- [x] ✅ Track referral conversions (referred customer qualifies)
- [x] ✅ Award referrer reward on qualification
- [x] ✅ Optionally award referred customer incentive
- [x] ✅ Display referral stats (invites, conversions, rewards)
- [x] ✅ Prevent fraud (self-referral, same email)
- [x] ✅ Write tests

### 10.2 Routes
- [x] ✅ Create `GET /api/v1/community/referral` endpoint (my code + stats)
- [x] ✅ Create `POST /api/v1/community/referral/track` endpoint

---

## 11. Reviews & Testimonials

### 11.1 Review Service
- [x] ✅ Create `community-reviews.service.ts`
- [x] ✅ Support review submission (rating, content, service, staff)
- [x] ✅ Prevent duplicate reviews per booking
- [x] ✅ Moderation workflow (pending → published/rejected)
- [x] ✅ Support business response (public reply)
- [x] ✅ Calculate average rating per service and staff
- [x] ✅ Trigger review request post-visit (automated notification)
- [x] ✅ Write tests

### 11.2 Routes
- [x] ✅ Create `POST /api/v1/community/reviews` endpoint
- [x] ✅ Create `GET /api/v1/community/reviews/service/:sid` endpoint
- [x] ✅ Create `PUT /api/v1/community/reviews/:id/respond` endpoint
- [x] ✅ Create `PUT /api/v1/community/reviews/:id/moderate` endpoint

---

## 12. Engagement Notifications

### 12.1 Notification Triggers
- [x] ✅ Send notifications for: challenge starting, streak at risk, badge earned, points milestone, new staff post, leaderboard change, new content
- [x] ✅ Integrate with marketing automation for engagement sequences
- [x] ✅ Make engagement data available to segmentation engine
- [x] ✅ Respect notification preferences
- [x] ✅ Write tests

---

## 13. Frontend (Web)

### 13.1 Community Page
- [x] ✅ Create `/community` page with tabbed layout
- [x] ✅ Feed tab (posts, reactions, comments, create post)
- [x] ✅ Challenges tab (active, join, progress cards)
- [x] ✅ Leaderboard tab (type selector, rankings)
- [x] ✅ Content tab (VOD library + courses)

### 13.2 Profile Engagement Section
- [x] ✅ Points balance + history
- [x] ✅ Badge showcase (earned badges grid)
- [x] ✅ Streak counter + longest streak
- [x] ✅ Referral code + share button + stats
- [x] ✅ Challenges in progress

### 13.3 Admin Pages
- [x] ✅ Challenge management (create, view participants, results)
- [x] ✅ Points/badge configuration
- [x] ✅ VOD content management (upload, categorize)
- [x] ✅ Course builder (modules, lessons, content)
- [x] ✅ Review moderation queue
- [x] ✅ Referral program settings

---

## 14. Mobile App Screens

### 14.1 Community Tab
- [x] ✅ Add community tab to mobile app navigation
- [x] ✅ Community feed (scroll, react, comment, post)
- [x] ✅ Challenge cards with progress
- [x] ✅ Leaderboard display

### 14.2 Engagement Screens
- [x] ✅ Points + badges showcase screen
- [x] ✅ Streak counter with animation
- [x] ✅ VOD player (full-screen video)
- [x] ✅ Course lesson viewer
- [x] ✅ Referral share (native share sheet)
- [x] ✅ Review submission (post-visit prompt)

---

## 15. Testing

### 15.1 Unit Tests
- [x] ✅ Test feed CRUD (posts, reactions, comments, moderation)
- [x] ✅ Test challenge progress tracking (attendance → progress increment → completion)
- [x] ✅ Test points system (award, balance, expiry, redemption)
- [x] ✅ Test badge criteria evaluation and auto-award
- [x] ✅ Test streak calculation (maintain, break, freeze)
- [x] ✅ Test leaderboard ranking (sort, opt-out, reset)
- [x] ✅ Test VOD progress tracking (resume, completion)
- [x] ✅ Test course enrollment and lesson progress
- [x] ✅ Test referral flow (code → registration → qualification → reward)
- [x] ✅ Test review submission and moderation

### 15.2 Integration Tests
- [x] ✅ Test full engagement flow (check-in → points + streak + challenge progress)
- [x] ✅ Test challenge completion → reward + badge + feed post
- [x] ✅ Test referral conversion → rewards for both parties
- [x] ✅ Test review request → submit → moderate → display
- [x] ✅ Test leaderboard with opt-out customers hidden
- [x] ✅ Test tenant scoping (community data isolated)
