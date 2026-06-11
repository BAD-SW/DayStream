# Phase 21: AI Features - Requirements

## Overview

This phase differentiates the platform from competitors by adding AI-powered capabilities across three areas: customer-facing AI (booking assistant, chatbot), business intelligence AI (insights, predictions, optimization), and personalization (recommendations, smart scheduling). The AI layer consumes platform data and provides actionable outputs — it does not replace existing modules but enhances them with intelligence. The LLM provider is not pre-selected and will be abstracted behind an interface.

## Goals

- Build an AI booking assistant for natural language scheduling queries
- Implement an AI receptionist chatbot for customer self-service
- Provide AI-powered business intelligence (revenue forecasting, churn prediction, staffing optimization)
- Implement personalization engine (service recommendations, optimal booking times)
- Abstract AI provider behind an interface for flexibility
- Ensure per-tenant data isolation in AI processing
- Support multi-language AI interactions

## Glossary

- **AI_Provider**: The external LLM service used for text generation and reasoning (e.g., OpenAI, Anthropic, AWS Bedrock)
- **AI_Adapter**: The abstraction layer interface normalizing AI_Provider interactions
- **Booking_Assistant**: A conversational AI that helps customers find and book services
- **AI_Receptionist**: A chatbot handling customer inquiries, FAQs, and basic operations
- **Business_Insight**: An AI-generated observation about business performance or trends
- **Prediction**: A data-driven forecast of future behavior (churn probability, demand forecast)
- **Recommendation**: A personalized suggestion for a customer (service, time, plan)
- **Prompt_Template**: A configurable text template used to instruct the AI_Provider
- **Conversation_Context**: The accumulated message history within an AI interaction
- **Embedding**: A numerical vector representation of text used for similarity search

## Requirements

### Requirement 1: AI Provider Abstraction Layer

**User Story:** As a platform operator, I want AI capabilities abstracted behind an interface, so that we can evaluate and switch LLM providers without rewriting features.

#### Acceptance Criteria

1. THE system SHALL define an `AI_Adapter` interface with methods: generateText (prompt → response), generateChat (conversation history → response), generateEmbedding (text → vector), classifyIntent (text → intent category), extractEntities (text → structured data)
2. THE system SHALL support multiple AI_Adapter implementations (one per provider)
3. THE system SHALL allow configuring which AI_Provider is active (global or per-tenant)
4. THE system SHALL normalize provider-specific responses into a common format
5. THE system SHALL handle provider errors gracefully (timeout, rate limit, unavailability) with fallback messaging
6. THE system SHALL log all AI interactions (prompt, response, tokens used, latency) for monitoring and cost tracking
7. THE system SHALL support a mock adapter for local development and testing
8. THE system SHALL enforce per-tenant data isolation (tenant A's data never appears in tenant B's AI context)

### Requirement 2: AI Booking Assistant

**User Story:** As a customer, I want to ask natural language questions about availability and have the AI help me book, so that scheduling is conversational and effortless.

#### Acceptance Criteria

1. THE Booking_Assistant SHALL understand natural language scheduling queries: "When can I book a massage this week?", "I want a 60-minute Float Tank on Saturday afternoon", "What's available tomorrow with Maria?", "Book me the same time as last week"
2. THE Booking_Assistant SHALL query the Availability Engine (Phase 07) to find matching slots
3. THE Booking_Assistant SHALL present available options in a user-friendly format
4. THE Booking_Assistant SHALL allow the customer to confirm and book a slot within the conversation
5. THE Booking_Assistant SHALL understand context across a conversation (follow-up questions, refinements)
6. THE Booking_Assistant SHALL support multi-language interactions based on customer preference
7. THE Booking_Assistant SHALL fall back gracefully if it cannot understand a query (suggest browsing the catalog or contacting reception)
8. THE Booking_Assistant SHALL never fabricate availability — only present real slots from the engine
9. THE Booking_Assistant SHALL be accessible from: web chat widget, mobile app, WhatsApp (Phase 20)

### Requirement 3: Service Recommendations

**User Story:** As a customer, I want personalized service suggestions based on my history and goals, so that I discover services I'll enjoy.

#### Acceptance Criteria

1. THE system SHALL recommend services based on: customer's booking history (similar services to what they've booked before), customer's wellness goals (from profile notes), popular services among similar customers (collaborative filtering), complementary services (booked a massage? try red light therapy)
2. THE system SHALL display recommendations on: customer dashboard (web and mobile), post-booking confirmation ("You might also like..."), service catalog browsing ("Recommended for you")
3. THE system SHALL support "recovery plan" suggestions (multi-service combinations based on customer goals)
4. THE system SHALL learn from customer responses (booked a recommendation → reinforce; dismissed → adjust)
5. THE system SHALL respect service access rules (don't recommend services the customer can't book)
6. THE system SHALL be explainable ("Recommended because you enjoyed Sports Massage")

### Requirement 4: AI Receptionist Chatbot

**User Story:** As a customer, I want to get instant answers to common questions via chat, so that I don't have to call or wait for a response.

#### Acceptance Criteria

1. THE AI_Receptionist SHALL handle common customer queries: business hours and location, service information (descriptions, pricing, duration), membership plan details and comparison, booking policy (cancellation, rescheduling), FAQ answers (what to bring, preparation, etc.)
2. THE AI_Receptionist SHALL be trained on tenant-specific content (services, policies, FAQs configured per tenant)
3. THE AI_Receptionist SHALL support escalation to a human when it cannot resolve a query
4. THE AI_Receptionist SHALL support performing actions: look up a customer's upcoming bookings, initiate a booking flow (hand off to Booking_Assistant), check membership status and credits, provide waitlist status
5. THE AI_Receptionist SHALL maintain conversation history within a session
6. THE AI_Receptionist SHALL greet customers by name if authenticated
7. THE AI_Receptionist SHALL support multi-language conversations
8. THE AI_Receptionist SHALL be deployable as: web chat widget on tenant site, mobile app chat, WhatsApp conversational bot (Phase 20)
9. THE AI_Receptionist SHALL never share one customer's data with another

### Requirement 5: Revenue Forecasting

**User Story:** As a business owner, I want AI-generated revenue forecasts, so that I can plan staffing, marketing, and expenses with confidence.

#### Acceptance Criteria

1. THE system SHALL generate revenue forecasts for the next 30, 60, and 90 days
2. THE system SHALL base forecasts on: historical revenue patterns, active membership recurring revenue, current booking pipeline, seasonal trends, growth/decline trajectory
3. THE system SHALL display forecasts as a trend line with confidence intervals
4. THE system SHALL update forecasts daily as new data comes in
5. THE system SHALL highlight anomalies (revenue significantly above or below forecast)
6. THE system SHALL provide explanations for forecast changes ("Revenue trending up due to 15 new memberships this month")
7. THE system SHALL display forecasts on the Business Owner dashboard (Phase 17)

### Requirement 6: Churn Prediction

**User Story:** As a business owner, I want to know which customers are at risk of leaving, so that I can proactively engage them.

#### Acceptance Criteria

1. THE system SHALL calculate a churn risk score per customer (low, medium, high)
2. THE system SHALL base churn prediction on: declining visit frequency, membership approaching expiration without renewal signal, no booking in X days (relative to their typical pattern), reduced credit usage, negative interactions (cancellations, complaints)
3. THE system SHALL identify at-risk customers in a dedicated list/segment
4. THE system SHALL suggest re-engagement actions per at-risk customer ("Send them a 20% off offer", "Their favorite therapist has availability Thursday")
5. THE system SHALL integrate with marketing automation (Phase 16) to trigger re-engagement sequences automatically
6. THE system SHALL track prediction accuracy over time (did predicted churners actually churn?)
7. THE system SHALL update risk scores daily

### Requirement 7: Staff Scheduling Optimization

**User Story:** As a manager, I want AI suggestions for optimal staff schedules, so that I match supply to demand without overstaffing or understaffing.

#### Acceptance Criteria

1. THE system SHALL analyze booking patterns (peak hours, popular services, day-of-week trends)
2. THE system SHALL suggest optimal staff schedules based on predicted demand
3. THE system SHALL identify overstaffed periods (more staff than bookings justify)
4. THE system SHALL identify understaffed periods (demand exceeds available capacity, waitlists forming)
5. THE system SHALL recommend hiring/scheduling changes ("Add a massage therapist on Thursdays — you're turning away 5+ bookings per week")
6. THE system SHALL consider staff preferences and constraints when making suggestions
7. THE system SHALL present suggestions as recommendations (not automatic changes — manager decides)

### Requirement 8: Smart Rebooking Suggestions

**User Story:** As a customer, I want the platform to suggest when I should rebook, so that I maintain a consistent wellness routine.

#### Acceptance Criteria

1. THE system SHALL detect customer booking patterns (e.g., massage every 2 weeks, float tank monthly)
2. THE system SHALL suggest rebooking at the optimal interval based on their history
3. THE system SHALL suggest the customer's preferred: day of week, time of day, staff member
4. THE system SHALL send rebooking reminders via notification (configurable timing)
5. THE system SHALL include one-tap booking for the suggested slot (if available)
6. THE system SHALL learn from customer behavior (declined suggestions → adjust frequency)

### Requirement 9: Demand-Based Pricing Suggestions

**User Story:** As a business owner, I want AI to suggest pricing adjustments based on demand, so that I can optimize revenue.

#### Acceptance Criteria

1. THE system SHALL analyze demand patterns per service (high demand vs. low demand periods)
2. THE system SHALL suggest price adjustments: increase prices during high-demand windows, offer discounts during low-demand windows, identify underpriced services (consistently sold out → room to increase)
3. THE system SHALL present suggestions with supporting data (demand charts, utilization rates)
4. THE system SHALL NEVER auto-apply pricing changes (suggestions only — owner decides)
5. THE system SHALL simulate the revenue impact of a proposed price change
6. THE system SHALL consider competitive positioning (if market data is available)

### Requirement 10: AI-Powered FAQ Generation

**User Story:** As a business owner, I want the AI to suggest FAQ answers based on customer inquiries, so that common questions are answered proactively.

#### Acceptance Criteria

1. THE system SHALL analyze chatbot conversations to identify frequently asked questions
2. THE system SHALL generate suggested FAQ entries (question + answer) from common queries
3. THE system SHALL present suggestions to the admin for review and approval
4. THE system SHALL auto-populate the tenant's FAQ page (Phase 18) with approved entries
5. THE system SHALL improve AI_Receptionist responses as FAQ entries are added
6. THE system SHALL identify gaps (questions the chatbot couldn't answer) and flag them for content creation

### Requirement 11: Engagement Scoring

**User Story:** As a business owner, I want to understand how engaged each customer is, so that I can identify my best customers and those needing attention.

#### Acceptance Criteria

1. THE system SHALL calculate an engagement score per customer (0–100 scale)
2. THE score SHALL consider: visit frequency, booking regularity, credit utilization, event participation, marketing email engagement, referrals, tenure, spend
3. THE system SHALL categorize customers by engagement level: highly engaged, engaged, neutral, disengaged, at-risk
4. THE system SHALL make engagement scores available for segmentation (Phase 05) and marketing targeting (Phase 16)
5. THE system SHALL update engagement scores daily
6. THE system SHALL track engagement trends over time (improving, stable, declining)
7. THE system SHALL display top engaged customers on the business dashboard

---

## Dependencies

- Phase 00: Infrastructure - Database, API
- Phase 02: Security & Compliance - Data privacy (tenant isolation in AI context), audit logging
- Phase 03: Core Platform - Tenant context, configuration engine, i18n (multi-language AI)
- Phase 05: Customer Management - Customer data, segments, activity timeline
- Phase 07: Booking Engine - Availability data, booking history
- Phase 08: Membership Engine - Membership data, credit usage
- Phase 09: Pricing Engine - Price data for suggestions
- Phase 12: Staff Management - Staff schedules for optimization
- Phase 16: Marketing & Automation - Trigger sequences from AI insights
- Phase 17: Reporting & Analytics - Historical data for predictions and forecasting
- Phase 20: Integrations - WhatsApp as a chatbot channel

## Success Criteria

- AI_Adapter interface supports at least one LLM provider with mock adapter for testing
- Booking Assistant understands natural language queries and returns real availability
- Service recommendations are personalized and explainable
- AI Receptionist answers common questions correctly using tenant-specific knowledge
- Revenue forecasts are generated daily with reasonable accuracy (within 15% of actual)
- Churn predictions identify at-risk customers before they cancel
- Staff scheduling suggestions correlate with actual demand patterns
- Smart rebooking suggestions increase repeat booking rates
- All AI features respect tenant data isolation
- AI responses are in the customer's preferred language

## Out of Scope

- Training custom ML models from scratch - Use pre-trained LLMs via API
- Real-time voice AI (phone call handling) - Future enhancement
- Computer vision (image recognition) - Not applicable to current scope
- Autonomous decision-making (AI takes actions without approval) - All actions require human confirmation
- AI-generated marketing copy - Could be added but is a Phase 16 enhancement
- Sentiment analysis of reviews/feedback - Future enhancement

## Notes

- **AI provider is NOT pre-selected** — evaluated per THIRD_PARTY_SERVICES.md when implementation begins
- Mock adapter enables full development and testing without real LLM costs
- Tenant data isolation is CRITICAL — never mix data between tenants in AI prompts or training
- AI features should degrade gracefully if the provider is unavailable (show "AI unavailable" not crash)
- Cost management is important — track token usage per tenant, set limits, consider caching common queries
- Predictions (churn, demand) can start with simple heuristic rules and evolve to ML models over time
- The Booking Assistant must NEVER hallucinate availability — always validate against the real Availability Engine
- Multi-language support depends on the LLM's language capabilities (most support EN/ES well)

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 05, Phase 07, Phase 08, Phase 09, Phase 12, Phase 16, Phase 17, Phase 20
**Next Phase**: Phase 22 (Community & Engagement)
