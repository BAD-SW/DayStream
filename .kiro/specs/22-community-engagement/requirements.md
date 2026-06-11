# Phase 22: Community & Engagement - Requirements

## Overview

This phase builds social and gamification features designed to increase customer retention and engagement. Community features give customers reasons to stay connected to the business beyond just appointments — through challenges, achievements, social interaction, content consumption, and friendly competition. This phase also includes video-on-demand and online course capabilities for businesses that want to extend their services digitally.

## Goals

- Build a community feed for social engagement within the tenant's customer base
- Implement challenges and programs with progress tracking
- Build a gamification system (points, badges, streaks, leaderboards)
- Support video-on-demand (wellness content library)
- Support online courses / LMS (structured learning)
- Implement referral programs
- Support reviews and testimonials

## Glossary

- **Community_Feed**: A social timeline where customers and staff can share updates, achievements, and encouragement
- **Challenge**: A time-bound program with defined goals that customers participate in (e.g., "30-Day Cold Therapy Challenge")
- **Achievement**: A milestone or badge earned by a customer for specific actions
- **Points**: A unit of gamification currency earned through engagement activities
- **Leaderboard**: A ranked list of customers by points, visits, or challenge progress
- **Streak**: Consecutive days/weeks of activity (e.g., 5 weeks in a row of attending)
- **VOD_Content**: Video-on-demand content (guided sessions, tutorials, wellness content)
- **Course**: A structured sequence of lessons with progress tracking
- **Referral**: A customer inviting a new customer to the business for a reward
- **Testimonial**: A customer's public review or endorsement of the business

## Requirements

### Requirement 1: Community Feed

**User Story:** As a customer, I want to see what's happening in my wellness community, so that I feel connected and motivated.

#### Acceptance Criteria

1. THE system SHALL provide a Community_Feed per Tenant visible to authenticated customers
2. THE Community_Feed SHALL support post types: text updates, images with captions, achievement announcements (auto-posted), challenge milestones (auto-posted), staff updates/tips, event announcements
3. THE system SHALL allow customers to create posts (text, image) if permitted by tenant configuration
4. THE system SHALL allow staff to create posts and announcements
5. THE system SHALL support reactions on posts (like, celebrate, motivate — configurable emoji set)
6. THE system SHALL support comments on posts
7. THE system SHALL display the feed in reverse chronological order (newest first)
8. THE system SHALL support moderation: staff can delete inappropriate posts, tenant can enable/disable customer posting, profanity filter (configurable word list)
9. THE system SHALL respect privacy (no personal health data visible in feed unless customer explicitly shares)
10. THE system SHALL be accessible from web and mobile app (Phase 19)

### Requirement 2: Challenges and Programs

**User Story:** As a customer, I want to join challenges that motivate me to maintain my wellness routine, so that I stay committed and engaged.

#### Acceptance Criteria

1. THE system SHALL support creating Challenges with: title, description, duration (start date, end date), goal type (visit count, specific services, consistency), rules (what counts toward completion), rewards (points, badge, discount, free session), capacity (optional limit), image/banner
2. THE system SHALL support challenge types: Attendance-based (visit X times in Y days), Service-specific (complete 10 sauna sessions this month), Streak-based (visit every week for 8 weeks), Custom metric (configurable goals)
3. THE system SHALL allow customers to join active challenges
4. THE system SHALL track progress per participant automatically (from check-in/booking data)
5. THE system SHALL display challenge progress (e.g., "7 of 10 sessions completed")
6. THE system SHALL announce challenge completions in the Community_Feed
7. THE system SHALL award configured rewards upon challenge completion
8. THE system SHALL display a challenge leaderboard (participants ranked by progress)
9. THE system SHALL support recurring challenges (e.g., monthly attendance challenge resets each month)

### Requirement 3: Points and Rewards System

**User Story:** As a customer, I want to earn points for my activities, so that engagement is rewarded and I have incentive to stay active.

#### Acceptance Criteria

1. THE system SHALL support a configurable points system per Tenant
2. THE system SHALL award points for: booking attendance (configurable per service type), membership renewal, challenge completion, referrals, community engagement (posting, reacting), streak milestones, first-time activities (first class, first workshop)
3. THE system SHALL support configuring points values per activity (e.g., attendance = 10 points, referral = 50 points)
4. THE system SHALL display current points balance on the customer dashboard
5. THE system SHALL display points history (earned, spent, expired)
6. THE system SHALL support points expiration (configurable: 12 months from earning, or never expire)
7. THE system SHALL support points redemption for: discounts on services (e.g., 500 points = €10 off), free sessions, merchandise, membership upgrades
8. THE system SHALL provide a rewards catalog (what can be redeemed and at what points cost)
9. THE system SHALL prevent negative points balance

### Requirement 4: Badges and Achievements

**User Story:** As a customer, I want to earn badges for milestones, so that I feel recognized for my progress.

#### Acceptance Criteria

1. THE system SHALL support a badge/achievement system per Tenant
2. THE system SHALL support configurable badges triggered by: visit milestones (10 visits, 50 visits, 100 visits), streak milestones (4-week streak, 12-week streak), challenge completion, specific services tried (tried all recovery services), tenure milestones (1 year member), referral milestones (referred 5 friends), spending milestones
3. THE system SHALL display earned badges on the customer profile
4. THE system SHALL announce new badge earnings in the Community_Feed (opt-in per customer)
5. THE system SHALL support badge tiers (bronze, silver, gold for increasing milestones)
6. THE system SHALL provide badge artwork/icons per badge type
7. THE system SHALL award badges automatically when criteria are met

### Requirement 5: Streaks

**User Story:** As a customer, I want my consistency tracked and rewarded, so that I'm motivated to maintain my routine.

#### Acceptance Criteria

1. THE system SHALL track attendance streaks per customer (consecutive weeks with at least one visit)
2. THE system SHALL display current streak length on the customer dashboard
3. THE system SHALL display longest streak ever achieved
4. THE system SHALL award points or badges at streak milestones (e.g., 4 weeks, 8 weeks, 12 weeks, 26 weeks, 52 weeks)
5. THE system SHALL send a warning notification when a streak is about to break ("Visit by Sunday to keep your 6-week streak!")
6. THE system SHALL support configurable streak rules per tenant (what counts as maintaining the streak)
7. THE system SHALL support a "streak freeze" (one free pass per month to maintain streak without visiting)

### Requirement 6: Leaderboards

**User Story:** As a customer, I want to see how I compare to other members, so that friendly competition motivates me.

#### Acceptance Criteria

1. THE system SHALL support leaderboards ranked by: total points (all-time and monthly), current streak, challenge progress, visit count (monthly)
2. THE system SHALL display top N customers on each leaderboard (configurable, default: 10)
3. THE system SHALL display the current customer's rank and position
4. THE system SHALL reset time-based leaderboards at the configured interval (monthly)
5. THE system SHALL support opt-out (customers can hide themselves from leaderboards)
6. THE system SHALL use display names (not full names) for privacy
7. THE system SHALL display leaderboards in the app and on the community page

### Requirement 7: Video-on-Demand (VOD)

**User Story:** As a customer, I want to access wellness videos (guided sessions, exercises, tips), so that I can continue my practice at home.

#### Acceptance Criteria

1. THE system SHALL support uploading and managing video content per Tenant
2. THE system SHALL support video metadata: title, description, duration, category/tags, thumbnail, instructor/staff, difficulty level, access level (free, members-only, specific plan)
3. THE system SHALL support organizing videos into categories and playlists
4. THE system SHALL support video streaming (adaptive bitrate for different connections)
5. THE system SHALL track viewing progress per customer (resume where left off)
6. THE system SHALL track video completion (for points/achievements)
7. THE system SHALL support access control (members-only content, plan-gated content)
8. THE system SHALL display a video library browsable by category, instructor, and difficulty
9. THE system SHALL support video search by title and tag
10. THE system SHALL be viewable from web and mobile app

### Requirement 8: Online Courses / LMS

**User Story:** As a business owner, I want to offer structured courses (nutrition plans, wellness education), so that I can deliver additional value to customers.

#### Acceptance Criteria

1. THE system SHALL support creating Courses with: title, description, instructor, image, access level (free, paid, members-only), estimated duration
2. THE system SHALL support course structure: modules → lessons (sequential or flexible order)
3. THE system SHALL support lesson content types: video, text (rich text), downloadable file (PDF, worksheet), quiz (simple multiple choice)
4. THE system SHALL track progress per customer per course (lessons completed / total)
5. THE system SHALL support marking lessons as complete
6. THE system SHALL support course completion certificates (generated PDF with customer name, course, date)
7. THE system SHALL support prerequisite courses (must complete Course A before starting Course B)
8. THE system SHALL display enrolled courses and progress on the customer dashboard
9. THE system SHALL award points/badges on course completion
10. THE system SHALL support paid courses (one-time purchase via Payment Platform)

### Requirement 9: Referral Program

**User Story:** As a customer, I want to refer friends and earn rewards, so that I benefit from bringing new people to the business.

#### Acceptance Criteria

1. THE system SHALL generate a unique referral code or link per customer
2. THE system SHALL track when a referred customer registers and completes a qualifying action (first booking, membership purchase)
3. THE system SHALL award the referrer a configurable reward: points, credit, discount code, free session, monetary credit
4. THE system SHALL optionally award the referred customer an incentive (e.g., 10% off first booking)
5. THE system SHALL display referral statistics to the customer (invites sent, successful referrals, rewards earned)
6. THE system SHALL support configuring referral rules per Tenant: qualifying action (what the referee must do), reward type and value, maximum referrals per customer (optional cap), reward expiration
7. THE system SHALL prevent self-referral and fraud (same email, same household detection)
8. THE system SHALL announce successful referrals in the Community_Feed (opt-in)

### Requirement 10: Reviews and Testimonials

**User Story:** As a customer, I want to leave a review after a service, so that I can share my experience and help others decide.

#### Acceptance Criteria

1. THE system SHALL support requesting a review after a completed booking (automated post-visit email/notification)
2. THE system SHALL support review content: star rating (1–5), written review (optional), service reviewed, staff member reviewed (optional)
3. THE system SHALL require authentication to submit a review (verified customer)
4. THE system SHALL support moderation: published/pending/rejected status, business response (public reply from staff)
5. THE system SHALL display approved reviews on the service detail page (Phase 18) and staff profile
6. THE system SHALL calculate and display average rating per service and per staff member
7. THE system SHALL prevent duplicate reviews for the same booking
8. THE system SHALL support flagging inappropriate reviews
9. THE system SHALL integrate with the AI_Receptionist (Phase 21) for FAQ sourcing from common review themes

### Requirement 11: Notification and Engagement Triggers

**User Story:** As a business owner, I want the community features to drive engagement automatically, so that customers are nudged to participate without manual effort.

#### Acceptance Criteria

1. THE system SHALL send notifications for: challenge starting soon (joined challenges), streak at risk ("Visit by Sunday!"), new badge earned, points awarded (milestone amounts), new community post from staff, leaderboard position change, new content available (VOD, course)
2. THE system SHALL integrate with marketing automation (Phase 16) for engagement-based sequences
3. THE system SHALL make engagement data available to the segmentation engine (Phase 05) — e.g., "highly engaged" segment
4. THE system SHALL make engagement data available to churn prediction (Phase 21)
5. THE system SHALL respect customer notification preferences for community alerts

---

## Dependencies

- Phase 00: Infrastructure - Database, API, file/video storage
- Phase 02: Security & Compliance - RBAC, audit logging, content moderation
- Phase 03: Core Platform - Tenant context, configuration engine, i18n, feature flags
- Phase 04: Design System - Feed UI, progress bars, badge displays, video player
- Phase 05: Customer Management - Customer profiles, segments, Activity_Timeline
- Phase 07: Booking Engine - Attendance data (for streaks, challenges, points)
- Phase 08: Membership Engine - Membership gating for premium content
- Phase 10: Payment Platform - Paid courses, referral rewards
- Phase 15: Check-In System - Check-in data triggers challenge progress
- Phase 16: Marketing & Automation - Engagement-triggered sequences
- Phase 19: Mobile Application - Mobile feed, video player, notifications
- Phase 21: AI Features - Engagement scoring, personalized recommendations

## Success Criteria

- Community feed displays posts and auto-generated achievements correctly
- Challenges track progress automatically from attendance data
- Points are awarded correctly and redeemable from the rewards catalog
- Badges trigger automatically at milestones
- Streaks calculate correctly with warning notifications before breaking
- Leaderboards rank participants accurately with opt-out support
- Videos stream smoothly with progress tracking and access control
- Courses track lesson completion and award certificates
- Referral codes track conversions and award rewards correctly
- Reviews are collected post-visit with moderation workflow
- All community data is strictly tenant-scoped

## Out of Scope

- Live streaming (real-time classes via video call) - Future enhancement
- Direct messaging between customers - Privacy concerns; future evaluation
- Social login sharing (post to Instagram/Facebook) - Out of platform scope
- User-generated video content - Only staff/admin upload
- Advanced LMS (SCORM compliance, proctored exams) - Lightweight course system only
- Physical merchandise store (reward redemption for physical goods) - Out of scope initially

## Notes

- Video hosting provider is NOT pre-selected (Mux, Cloudflare Stream, self-hosted) — per THIRD_PARTY_SERVICES.md
- Video storage will be significant — plan for CDN delivery and consider storage costs
- Community features should be individually toggleable via feature flags (not all tenants want all features)
- Gamification works best when rewards have real value (discounts, free sessions, not just virtual badges)
- Privacy is important — opt-in for leaderboard visibility, no sharing of personal health data
- Referral fraud prevention is important but shouldn't be over-engineered initially
- Reviews build SEO value for tenant sites (structured data for Google star ratings)
- LMS is lightweight — not competing with Teachable/Udemy; just enough for a wellness business to share content
- Streaks are a proven retention mechanism (see Duolingo, fitness apps)

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 04, Phase 05, Phase 07, Phase 08, Phase 10, Phase 15, Phase 16, Phase 19, Phase 21
**Next Phase**: None (final functional phase)
