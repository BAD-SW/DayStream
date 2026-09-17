-- Phase 22: Community & Engagement tables

-- ============================================================
-- 1. Community Posts
-- ============================================================

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

CREATE INDEX idx_community_posts_tenant ON community_posts(tenant_id, created_at DESC);

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

CREATE INDEX idx_community_comments_post ON community_comments(post_id);

-- ============================================================
-- 2. Challenges
-- ============================================================

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

CREATE INDEX idx_challenges_tenant ON challenges(tenant_id, status);

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

CREATE INDEX idx_challenge_participants_challenge ON challenge_participants(challenge_id);
CREATE INDEX idx_challenge_participants_customer ON challenge_participants(customer_id);

-- ============================================================
-- 3. Points & Badges
-- ============================================================

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

CREATE INDEX idx_customer_points_customer ON customer_points(tenant_id, customer_id);

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

CREATE INDEX idx_badges_tenant ON badges(tenant_id);

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

-- ============================================================
-- 4. Video-on-Demand
-- ============================================================

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

CREATE INDEX idx_vod_content_tenant ON vod_content(tenant_id);

CREATE TABLE vod_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    content_id UUID NOT NULL REFERENCES vod_content(id) ON DELETE CASCADE,
    watched_seconds INTEGER NOT NULL DEFAULT 0,
    completed BOOLEAN NOT NULL DEFAULT false,
    last_watched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(customer_id, content_id)
);

-- ============================================================
-- 5. Courses
-- ============================================================

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

CREATE INDEX idx_courses_tenant ON courses(tenant_id);

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

CREATE INDEX idx_course_lessons_course ON course_lessons(course_id);

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

-- ============================================================
-- 6. Referrals
-- ============================================================

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

CREATE INDEX idx_referral_codes_tenant ON referral_codes(tenant_id);
CREATE INDEX idx_referral_codes_code ON referral_codes(code);

CREATE TABLE referrals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referral_code_id UUID NOT NULL REFERENCES referral_codes(id),
    referred_customer_id UUID NOT NULL REFERENCES customers(id),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'qualified', 'rewarded')),
    qualified_at TIMESTAMPTZ,
    rewarded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 7. Reviews
-- ============================================================

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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reviews_tenant ON reviews(tenant_id);
CREATE INDEX idx_reviews_service ON reviews(service_id);
CREATE INDEX idx_reviews_customer ON reviews(customer_id);

-- ============================================================
-- 8. RLS Policies
-- ============================================================

ALTER TABLE community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_posts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_community_posts ON community_posts FOR ALL TO daystream_app USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_community_posts ON community_posts FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE community_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_reactions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_community_reactions ON community_reactions FOR ALL TO daystream_app USING (post_id IN (SELECT id FROM community_posts WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_community_reactions ON community_reactions FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE community_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_comments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_community_comments ON community_comments FOR ALL TO daystream_app USING (post_id IN (SELECT id FROM community_posts WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_community_comments ON community_comments FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenges FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_challenges ON challenges FOR ALL TO daystream_app USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_challenges ON challenges FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE challenge_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_participants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_challenge_participants ON challenge_participants FOR ALL TO daystream_app USING (challenge_id IN (SELECT id FROM challenges WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_challenge_participants ON challenge_participants FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE customer_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_points FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_customer_points ON customer_points FOR ALL TO daystream_app USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_customer_points ON customer_points FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE badges FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_badges ON badges FOR ALL TO daystream_app USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_badges ON badges FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE customer_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_badges FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_customer_badges ON customer_badges FOR ALL TO daystream_app USING (badge_id IN (SELECT id FROM badges WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_customer_badges ON customer_badges FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE customer_streaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_streaks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_customer_streaks ON customer_streaks FOR ALL TO daystream_app USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_customer_streaks ON customer_streaks FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE vod_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE vod_content FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_vod_content ON vod_content FOR ALL TO daystream_app USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_vod_content ON vod_content FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE vod_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE vod_progress FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_vod_progress ON vod_progress FOR ALL TO daystream_app USING (content_id IN (SELECT id FROM vod_content WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_vod_progress ON vod_progress FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_courses ON courses FOR ALL TO daystream_app USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_courses ON courses FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE course_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_lessons FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_course_lessons ON course_lessons FOR ALL TO daystream_app USING (course_id IN (SELECT id FROM courses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_course_lessons ON course_lessons FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE course_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_enrollments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_course_enrollments ON course_enrollments FOR ALL TO daystream_app USING (course_id IN (SELECT id FROM courses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_course_enrollments ON course_enrollments FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE course_lesson_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_lesson_progress FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_course_lesson_progress ON course_lesson_progress FOR ALL TO daystream_app USING (enrollment_id IN (SELECT id FROM course_enrollments WHERE course_id IN (SELECT id FROM courses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)));
CREATE POLICY admin_full_access_course_lesson_progress ON course_lesson_progress FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_referral_codes ON referral_codes FOR ALL TO daystream_app USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_referral_codes ON referral_codes FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_referrals ON referrals FOR ALL TO daystream_app USING (referral_code_id IN (SELECT id FROM referral_codes WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_referrals ON referrals FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_reviews ON reviews FOR ALL TO daystream_app USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_reviews ON reviews FOR ALL TO CURRENT_USER USING (true);

-- ============================================================
-- 9. Grant Permissions
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON community_posts TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON community_reactions TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON community_comments TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON challenges TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON challenge_participants TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_points TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON badges TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_badges TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_streaks TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON vod_content TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON vod_progress TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON courses TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON course_lessons TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON course_enrollments TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON course_lesson_progress TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON referral_codes TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON referrals TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON reviews TO daystream_app;
