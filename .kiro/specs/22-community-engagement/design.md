# Phase 22: Community & Engagement - Design Document

**Date**: June 17, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 00, Phase 02–05, Phase 07–08, Phase 10, Phase 15–16, Phase 19

---

## Overview

This document describes the technical design for the DayStream community and engagement module — community feed, challenges with progress tracking, gamification (points, badges, streaks, leaderboards), video-on-demand, online courses, referral programs, and reviews. All features are individually toggleable via feature flags and accessible from both web and mobile.

---

## Table of Contents

1. [Database Schema](#1-database-schema)
2. [Community Feed](#2-community-feed)
3. [Challenges & Progress](#3-challenges--progress)
4. [Gamification Engine](#4-gamification-engine)
5. [Video-on-Demand](#5-video-on-demand)
6. [Online Courses](#6-online-courses)
7. [Referral Program](#7-referral-program)
8. [Reviews & Testimonials](#8-reviews--testimonials)
9. [API Endpoints](#9-api-endpoints)
10. [Frontend & Mobile Views](#10-frontend--mobile-views)

---

## 1. Database Schema

### Community Posts

```sql
CREATE TABLE community_posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    author_id UUID NOT NULL,
    author_type VARCHAR(20) NOT NULL CHECK (author_type IN ('customer', 'staff', 'system')),
    post_type VARCHAR(30) NOT NULL CHECK (post_type IN ('text', 'image', 'achievement', 'challenge_milestone', 'staff_update', 'announcement')),
    content TEXT,
    image_path TEXT,
    metadata JSONB DEFAULT '{}',
    is_pinned BOOLEAN NOT NULL DEFAULT false,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE community_reactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    reaction_type VARCHAR(20) NOT NULL DEFAULT 'like',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(post_id, customer_id)
);

CREATE TABLE community_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    author_id UUID NOT NULL,
    author_type VARCHAR(20) NOT NULL CHECK (author_type IN ('customer', 'staff')),
    content TEXT NOT NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Challenges

```sql
CREATE TABLE challenges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    challenge_type VARCHAR(30) NOT NULL CHECK (challenge_type IN ('attendance', 'service_specific', 'streak', 'custom')),
    goal_config JSONB NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reward_config JSONB DEFAULT '{}',
    capacity INTEGER,
    image_path TEXT,
    is_recurring BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'completed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE challenge_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    progress INTEGER NOT NULL DEFAULT 0,
    goal_target INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'withdrawn')),
    completed_at TIMESTAMPTZ,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(challenge_id, customer_id)
);
```

### Points & Badges

```sql
CREATE TABLE customer_points (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    points INTEGER NOT NULL,
    action VARCHAR(50) NOT NULL,
    description VARCHAR(200),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE badges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    icon_path TEXT,
    tier VARCHAR(20) DEFAULT 'standard',
    trigger_type VARCHAR(50) NOT NULL,
    trigger_config JSONB NOT NULL DEFAULT '{}',
    points_award INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE customer_badges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    badge_id UUID NOT NULL REFERENCES badges(id),
    earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(customer_id, badge_id)
);

CREATE TABLE customer_streaks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    current_streak INTEGER NOT NULL DEFAULT 0,
    longest_streak INTEGER NOT NULL DEFAULT 0,
    last_activity_week DATE,
    streak_freezes_remaining INTEGER NOT NULL DEFAULT 1,
    UNIQUE(tenant_id, customer_id)
);
```

### Video-on-Demand

```sql
CREATE TABLE vod_content (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    video_url TEXT NOT NULL,
    thumbnail_path TEXT,
    duration_seconds INTEGER,
    category VARCHAR(50),
    tags TEXT[] DEFAULT '{}',
    instructor_name VARCHAR(100),
    difficulty VARCHAR(20) CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
    access_level VARCHAR(20) NOT NULL DEFAULT 'members' CHECK (access_level IN ('free', 'members', 'plan_specific')),
    plan_ids JSONB DEFAULT '[]',
    status VARCHAR(20) NOT NULL DEFAULT 'published',
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE vod_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    content_id UUID NOT NULL REFERENCES vod_content(id) ON DELETE CASCADE,
    watched_seconds INTEGER NOT NULL DEFAULT 0,
    completed BOOLEAN NOT NULL DEFAULT false,
    last_watched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(customer_id, content_id)
);
```

### Courses

```sql
CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    instructor_name VARCHAR(100),
    image_path TEXT,
    access_level VARCHAR(20) NOT NULL DEFAULT 'members',
    price INTEGER DEFAULT 0,
    total_lessons INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE course_lessons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    module_name VARCHAR(100),
    title VARCHAR(200) NOT NULL,
    content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('video', 'text', 'file', 'quiz')),
    content JSONB NOT NULL DEFAULT '{}',
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE course_enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    lessons_completed INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'enrolled',
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE(course_id, customer_id)
);

CREATE TABLE course_lesson_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enrollment_id UUID NOT NULL REFERENCES course_enrollments(id) ON DELETE CASCADE,
    lesson_id UUID NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
    completed BOOLEAN NOT NULL DEFAULT false,
    completed_at TIMESTAMPTZ,
    UNIQUE(enrollment_id, lesson_id)
);
```

### Referrals

```sql
CREATE TABLE referral_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    code VARCHAR(20) NOT NULL UNIQUE,
    reward_config JSONB NOT NULL DEFAULT '{}',
    referrals_count INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE referrals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referral_code_id UUID NOT NULL REFERENCES referral_codes(id),
    referred_customer_id UUID NOT NULL REFERENCES customers(id),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'qualified', 'rewarded')),
    qualified_at TIMESTAMPTZ,
    rewarded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Reviews

```sql
CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    booking_id UUID,
    service_id UUID,
    staff_id UUID,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    content TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'rejected')),
    business_response TEXT,
    responded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(customer_id, booking_id)
);
```

---

## 2. Community Feed

- Posts displayed in reverse chronological order
- Auto-generated posts for achievements, challenge milestones, referrals
- Moderation: staff delete, profanity filter, tenant controls customer posting
- Reactions: configurable emoji set per tenant (default: like, celebrate, motivate)
- Comments: text-only, deletable by author or staff

---

## 3. Challenges & Progress

### Progress Tracking

```
On check-in or booking completion:
  1. Find active challenges the customer is participating in
  2. For each matching challenge:
     - Evaluate if this activity counts toward the goal (per challenge type/config)
     - If yes: increment progress
     - If progress >= goal_target: mark as completed, award rewards, post to feed
```

### Challenge Types

| Type | Goal Measurement |
|------|-----------------|
| attendance | Total check-ins in date range |
| service_specific | Check-ins for specific services |
| streak | Consecutive weeks with ≥1 visit |
| custom | Configurable metric from goal_config |

---

## 4. Gamification Engine

### Points

- Awarded on events: check-in, booking, referral, challenge complete, streak milestone
- Configurable per tenant (action → points amount)
- Optional expiration (12 months default)
- Redeemable from rewards catalog

### Badges

- Triggered automatically when criteria met
- Criteria evaluated on relevant events (check-in counter, streak update, etc.)
- Tiered: same badge at different levels (Bronze 10 visits → Silver 50 → Gold 100)

### Streaks

- Tracked weekly (at least one visit per week maintains streak)
- Updated on check-in (recalculate current streak)
- Warning notification sent if streak about to break (Sunday without visit)
- Streak freeze: 1 free pass per month (configurable)

### Leaderboards

- Computed from points, streaks, or visit counts
- Monthly reset for time-based boards
- Opt-out respected (customer hidden from rankings)
- Display names only (privacy)

---

## 5. Video-on-Demand

- Upload video to storage (Mux, Cloudflare Stream, or S3 + CDN)
- Metadata: title, description, category, instructor, difficulty, access level
- Access gating: free, members-only, specific plan
- Progress tracking per customer (resume, completion)
- Completion awards points

---

## 6. Online Courses

- Structure: Course → Modules → Lessons
- Lesson types: video, rich text, downloadable file, quiz
- Progress: track lessons completed per enrollment
- Completion certificate (generated PDF)
- Paid courses via Payment Platform
- Prerequisites supported

---

## 7. Referral Program

- Each customer gets a unique referral code
- Referred customer must complete qualifying action (first booking/membership)
- Referrer rewarded (points, credit, discount, or free session)
- Referred customer optionally gets incentive (welcome discount)
- Fraud prevention: same email check, cap per referrer

---

## 8. Reviews & Testimonials

- Triggered post-visit (automated email/push 24h after completed booking)
- Star rating (1-5) + optional written review
- Moderation workflow: pending → published/rejected
- Business can respond publicly
- Average ratings displayed on service and staff pages
- Structured data for SEO (Google star ratings)

---

## 9. API Endpoints

### Community Feed
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/community/feed` | Get feed (paginated) |
| POST | `/api/v1/community/posts` | Create post |
| POST | `/api/v1/community/posts/:id/react` | React to post |
| POST | `/api/v1/community/posts/:id/comments` | Comment |
| DELETE | `/api/v1/community/posts/:id` | Delete post (moderation) |

### Challenges
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/community/challenges` | List challenges |
| POST | `/api/v1/community/challenges` | Create challenge |
| POST | `/api/v1/community/challenges/:id/join` | Join challenge |
| GET | `/api/v1/community/challenges/:id/leaderboard` | Challenge leaderboard |
| GET | `/api/v1/community/challenges/my` | My active challenges + progress |

### Gamification
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/community/points` | My points balance + history |
| GET | `/api/v1/community/badges` | Available badges |
| GET | `/api/v1/community/badges/my` | My earned badges |
| GET | `/api/v1/community/streaks` | My streak info |
| GET | `/api/v1/community/leaderboard` | Leaderboard (type param) |
| GET | `/api/v1/community/rewards` | Rewards catalog |
| POST | `/api/v1/community/rewards/redeem` | Redeem points |

### VOD & Courses
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/community/vod` | Video library |
| GET | `/api/v1/community/vod/:id` | Video detail + progress |
| PUT | `/api/v1/community/vod/:id/progress` | Update watch progress |
| GET | `/api/v1/community/courses` | Course catalog |
| GET | `/api/v1/community/courses/:id` | Course detail + lessons |
| POST | `/api/v1/community/courses/:id/enroll` | Enroll in course |
| PUT | `/api/v1/community/courses/:id/lessons/:lid/complete` | Mark lesson complete |

### Referrals
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/community/referral` | My referral code + stats |
| POST | `/api/v1/community/referral/track` | Track referral conversion |

### Reviews
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/community/reviews` | Submit review |
| GET | `/api/v1/community/reviews/service/:sid` | Reviews for service |
| PUT | `/api/v1/community/reviews/:id/respond` | Business response |
| PUT | `/api/v1/community/reviews/:id/moderate` | Approve/reject |

---

## 10. Frontend & Mobile Views

### Web (`/community`)
- Feed tab (posts, reactions, comments)
- Challenges tab (active, join, progress)
- Leaderboard tab
- Content tab (VOD + courses)
- Profile section (points, badges, streaks, referral)

### Mobile (`packages/mobile/app/(tabs)/community.tsx`)
- Community feed (scroll, react, comment)
- My challenges (progress cards)
- Check-in rewards animation (points awarded)
- VOD player (full-screen video)
- Badge showcase
- Streak counter with warning
- Referral share (native share sheet)

---

**Last Updated**: June 17, 2026
