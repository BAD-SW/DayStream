# Phase 19: Mobile Application - Requirements

## Overview

This phase builds a cross-platform mobile application (iOS and Android) for customers to browse services, book appointments, manage memberships, check in, receive notifications, and interact with the business. The app provides a native mobile experience consuming the same API as the web client, with per-tenant branding to support white-label deployment.

## Goals

- Build a cross-platform mobile app (React Native + Expo)
- Implement customer authentication (email, Google, Apple)
- Provide service browsing and booking flow
- Enable membership viewing, purchasing, and management
- Implement push notifications (booking reminders, marketing, membership alerts)
- Support QR code check-in from the app
- Apply per-tenant branding (white-label)
- Publish to App Store and Google Play

## Glossary

- **Mobile_App**: The cross-platform React Native application for iOS and Android
- **Deep_Link**: A URL that navigates directly to a specific screen within the Mobile_App
- **Push_Notification**: A message delivered to the device's notification system outside the app
- **Offline_Cache**: Data stored locally on the device for offline access
- **White_Label**: Customizing the app's appearance (colors, logo, name) per tenant
- **OTA_Update**: Over-the-air code update delivered without going through the App Store review process
- **Device_Token**: A unique identifier registered with the push notification service for delivery

## Requirements

### Requirement 1: Authentication

**User Story:** As a customer, I want to sign in to the mobile app quickly, so that I can access my account and bookings.

#### Acceptance Criteria

1. THE Mobile_App SHALL support email and password authentication
2. THE Mobile_App SHALL support Google OAuth sign-in (native Google Sign-In SDK)
3. THE Mobile_App SHALL support Apple Sign-In (required for iOS App Store)
4. THE Mobile_App SHALL support multi-factor authentication (TOTP code entry)
5. THE Mobile_App SHALL store authentication tokens securely (iOS Keychain, Android Keystore)
6. THE Mobile_App SHALL support biometric login (fingerprint, Face ID) for returning users
7. THE Mobile_App SHALL automatically refresh expired access tokens using the refresh token
8. WHEN token refresh fails, THE Mobile_App SHALL redirect to the login screen
9. THE Mobile_App SHALL support "Stay signed in" (persistent session)
10. THE Mobile_App SHALL support signing out (clears all tokens and cached data)

### Requirement 2: Customer Dashboard

**User Story:** As a customer, I want to see my key information at a glance when I open the app, so that I know my upcoming bookings, membership status, and credits.

#### Acceptance Criteria

1. THE Mobile_App SHALL display a home dashboard upon login showing: active membership type and status, credit balance (if credit-based plan), next upcoming booking (date, time, service, staff), recent activity summary (last 3–5 events), quick actions (Book, My Bookings, Check In)
2. THE dashboard SHALL display a greeting with the customer's first name
3. THE dashboard SHALL display the tenant's branding (logo, colors)
4. THE dashboard SHALL pull-to-refresh for updated data
5. THE dashboard SHALL display promotional banners or announcements (configurable by tenant)
6. THE dashboard SHALL load within 2 seconds on a standard mobile connection

### Requirement 3: Service Browsing and Booking

**User Story:** As a customer, I want to browse services and book appointments from my phone, so that I can schedule without needing a computer.

#### Acceptance Criteria

1. THE Mobile_App SHALL display the service catalog organized by category
2. THE Mobile_App SHALL support searching services by name
3. THE Mobile_App SHALL support filtering by category, duration, and price range
4. THE Mobile_App SHALL display service details: description, images (swipeable gallery), variants (duration/price), staff, cancellation policy
5. THE Mobile_App SHALL provide the complete booking flow: Select service/variant → Choose date → Choose time slot → Select staff (optional) → Confirm → Pay → Confirmation
6. THE Mobile_App SHALL display available time slots from the Availability Engine (Phase 07)
7. THE Mobile_App SHALL support selecting a preferred staff member
8. THE Mobile_App SHALL hold the slot temporarily during checkout (same as web)
9. THE Mobile_App SHALL integrate with the Payment Platform (Phase 10) for in-app payment
10. THE Mobile_App SHALL display a booking confirmation with option to add to device calendar

### Requirement 4: Booking Management

**User Story:** As a customer, I want to view and manage my bookings from the app, so that I can cancel or reschedule when plans change.

#### Acceptance Criteria

1. THE Mobile_App SHALL display a list of upcoming bookings (sorted by date)
2. THE Mobile_App SHALL display a list of past bookings (history)
3. THE Mobile_App SHALL display booking details: service, date, time, staff, location, status, cancellation policy
4. THE Mobile_App SHALL support cancelling a booking (with policy enforcement and fee display)
5. THE Mobile_App SHALL support rescheduling a booking (select new date/time)
6. THE Mobile_App SHALL display booking status changes in real-time (confirmed, cancelled, rescheduled)
7. THE Mobile_App SHALL support adding a booking to the device's native calendar
8. THE Mobile_App SHALL display directions to the location (link to maps app)

### Requirement 5: Membership Management

**User Story:** As a customer, I want to view and manage my membership from the app, so that I can track credits, upgrade, or pause.

#### Acceptance Criteria

1. THE Mobile_App SHALL display active membership details: plan name, status, credits remaining (if credit-based), renewal date, benefits list
2. THE Mobile_App SHALL display credit transaction history (earned, spent, expired)
3. THE Mobile_App SHALL support browsing available membership plans
4. THE Mobile_App SHALL support purchasing a new membership (with in-app payment)
5. THE Mobile_App SHALL support upgrading/downgrading a plan (with proration display)
6. THE Mobile_App SHALL support pausing a membership (with terms displayed)
7. THE Mobile_App SHALL support cancelling a membership (with confirmation and implications)
8. THE Mobile_App SHALL display membership benefits and savings summary

### Requirement 6: In-App Payments

**User Story:** As a customer, I want to pay for bookings and memberships within the app, so that checkout is seamless.

#### Acceptance Criteria

1. THE Mobile_App SHALL integrate with the Payment Platform (Phase 10) via the PaymentAdapter
2. THE Mobile_App SHALL support paying with a stored payment method (card on file)
3. THE Mobile_App SHALL support adding a new payment method
4. THE Mobile_App SHALL support Apple Pay on iOS
5. THE Mobile_App SHALL support Google Pay on Android
6. THE Mobile_App SHALL display the Price_Breakdown from the Pricing Engine (base price, discounts, tax, total)
7. THE Mobile_App SHALL support applying discount codes during checkout
8. THE Mobile_App SHALL support redeeming gift card balance
9. THE Mobile_App SHALL display payment confirmation and receipt

### Requirement 7: Push Notifications

**User Story:** As a customer, I want to receive timely notifications on my phone, so that I'm reminded of bookings and informed of relevant offers.

#### Acceptance Criteria

1. THE Mobile_App SHALL register a Device_Token with the push notification service on login
2. THE Mobile_App SHALL support receiving notifications for: booking confirmations, booking reminders (24h, 2h before), booking cancellation/reschedule, membership renewal reminders, credit expiration warnings, waitlist spot available, marketing campaigns (from Phase 16), general announcements from the business
3. THE Mobile_App SHALL support Deep_Links in notifications (tap → navigate to relevant screen)
4. THE Mobile_App SHALL support notification preferences (customer can enable/disable categories)
5. THE Mobile_App SHALL display notification history in an in-app notification center
6. THE Mobile_App SHALL badge the app icon with unread notification count
7. THE Mobile_App SHALL handle notifications when the app is in foreground, background, and killed states

### Requirement 8: QR Code Check-In

**User Story:** As a customer, I want to check in for my appointment using my phone, so that arrival is fast and contactless.

#### Acceptance Criteria

1. THE Mobile_App SHALL display a QR code for the customer's next upcoming booking
2. THE Mobile_App SHALL display a persistent customer QR code (for membership/walk-in check-in)
3. THE QR code SHALL be clearly visible and scannable from the lock screen or home screen
4. THE Mobile_App SHALL support scanning a venue QR code to self-check-in
5. THE Mobile_App SHALL display a success/failure message after check-in attempt
6. THE Mobile_App SHALL support check-in up to 15 minutes before the booking start time (configurable)
7. THE QR code SHALL refresh periodically for security (time-bounded codes)

### Requirement 9: Profile Management

**User Story:** As a customer, I want to update my personal information and preferences from the app, so that my profile stays current.

#### Acceptance Criteria

1. THE Mobile_App SHALL allow viewing and editing: name, email, phone, date of birth, profile photo (camera or gallery), preferred language, communication preferences (email, SMS, push opt-in/out)
2. THE Mobile_App SHALL support changing password
3. THE Mobile_App SHALL support managing MFA settings
4. THE Mobile_App SHALL support viewing and managing stored payment methods
5. THE Mobile_App SHALL support viewing active sessions and signing out other devices
6. THE Mobile_App SHALL support requesting data export (GDPR)
7. THE Mobile_App SHALL support requesting account deletion (GDPR)

### Requirement 10: Per-Tenant Branding (White-Label)

**User Story:** As a business owner, I want the app to look like my brand, so that customers feel they're using my business's app.

#### Acceptance Criteria

1. THE Mobile_App SHALL apply the tenant's color scheme (primary, secondary, accent colors)
2. THE Mobile_App SHALL display the tenant's logo on the login screen and navigation
3. THE Mobile_App SHALL apply the tenant's configured font family (if available on device, fallback to system font)
4. THE Mobile_App SHALL load branding configuration from the Configuration_Engine (Phase 03) on login
5. THE Mobile_App SHALL cache branding locally for offline display
6. THE system SHALL support a single app binary with runtime branding (not separate builds per tenant)
7. THE Mobile_App SHALL support tenant selection on first launch (customer chooses their business or enters a code)

### Requirement 11: Offline Support

**User Story:** As a customer, I want to view my bookings and membership even without internet, so that I can check my schedule and show my QR code anywhere.

#### Acceptance Criteria

1. THE Mobile_App SHALL cache upcoming bookings locally for offline viewing
2. THE Mobile_App SHALL cache membership details and credit balance locally
3. THE Mobile_App SHALL display a cached QR code for check-in offline
4. THE Mobile_App SHALL display a clear "offline" indicator when not connected
5. THE Mobile_App SHALL queue actions performed offline (e.g., cancellation request) and sync when connection returns
6. THE Mobile_App SHALL refresh cached data when connection is restored
7. THE Mobile_App SHALL set a reasonable cache expiry (24 hours for schedule data)

### Requirement 12: Events and Workshops

**User Story:** As a customer, I want to browse and register for events from the app, so that I can discover workshops and experiences.

#### Acceptance Criteria

1. THE Mobile_App SHALL display upcoming events in a dedicated section
2. THE Mobile_App SHALL support filtering events by type, date, and availability
3. THE Mobile_App SHALL display event details: title, description, facilitator, date/time, capacity, pricing
4. THE Mobile_App SHALL support event registration and payment flow
5. THE Mobile_App SHALL display registered events alongside regular bookings in the calendar view
6. THE Mobile_App SHALL support cancelling event registrations (with policy enforcement)

### Requirement 13: App Store Deployment

**User Story:** As a platform operator, I want the app published on the App Store and Google Play, so that customers can download it.

#### Acceptance Criteria

1. THE Mobile_App SHALL be built for both iOS (App Store) and Android (Google Play Store)
2. THE Mobile_App SHALL comply with Apple App Store Review Guidelines
3. THE Mobile_App SHALL comply with Google Play Store policies
4. THE Mobile_App SHALL support OTA_Updates via Expo for non-native code changes
5. THE Mobile_App SHALL support versioning aligned with the platform's calendar versioning scheme (Phase 01)
6. THE system SHALL provide a build pipeline for generating release builds
7. THE Mobile_App SHALL support staged rollouts (percentage-based release to users)
8. THE Mobile_App SHALL include proper privacy policy and terms of service links

---

## Dependencies

- Phase 00: Infrastructure - API server (consumed by mobile)
- Phase 02: Security & Compliance - Authentication (JWT, OAuth, MFA, biometric), secure token storage
- Phase 03: Core Platform - Tenant context, configuration engine (branding), i18n, API infrastructure
- Phase 04: Design System - Design tokens (colors, typography) for mobile adaptation
- Phase 05: Customer Management - Customer profile data
- Phase 06: Service Management - Service catalog data
- Phase 07: Booking Engine - Availability calculation, booking flow API
- Phase 08: Membership Engine - Membership data, credit balance
- Phase 09: Pricing Engine - Price calculation API
- Phase 10: Payment Platform - Payment processing (Apple Pay, Google Pay, stored cards)
- Phase 14: Events & Workshops - Event listing and registration
- Phase 15: Check-In System - QR code generation and check-in API

## Success Criteria

- App installs and runs on iOS 15+ and Android 10+
- Authentication works with email, Google, Apple, biometrics, and MFA
- Service browsing and booking flow completes successfully on mobile
- Push notifications deliver for all configured event types
- QR code check-in works offline and scans correctly at venue
- Per-tenant branding applies at runtime from a single app binary
- Offline mode displays cached bookings and QR code without connection
- App meets App Store and Play Store review requirements
- Payment works with Apple Pay, Google Pay, and stored cards
- App loads dashboard within 2 seconds

## Out of Scope

- Separate builds per tenant (single binary with runtime branding) - white-label via config
- Wearable app (Apple Watch, WearOS) - Future enhancement
- Tablet-optimized layouts - Standard responsive for now
- Instructor/staff mobile app - This is customer-facing only; staff use the web admin
- In-app chat or messaging - Phase 22 (Community) or future
- Video calling / telehealth - Out of scope

## Notes

- React Native + Expo is the confirmed direction (ADR-006)
- Single app binary with tenant selection avoids maintaining multiple app store listings initially
- If a tenant wants their own app store listing (true white-label), that's a premium feature requiring separate build + deployment
- Push notification provider decision (Expo Push, Firebase, OneSignal) — evaluated per THIRD_PARTY_SERVICES.md
- Apple Pay / Google Pay integration depends on the chosen Payment_Adapter implementation
- App Store review can be slow (1–2 weeks); plan release cycles around review times
- OTA updates via Expo allow pushing fixes without full App Store re-review (non-native code only)
- Offline QR code is critical — customers may be in basement/underground wellness facilities with poor signal

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 04, Phase 05, Phase 06, Phase 07, Phase 08, Phase 09, Phase 10, Phase 14, Phase 15
**Next Phase**: Phase 20 (Integrations)
