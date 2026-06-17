# Phase 19: Mobile Application - Tasks

## Overview

Implementation tasks for the cross-platform mobile application — project setup, authentication, dashboard, service browsing/booking, booking management, membership, payments, push notifications, QR check-in, profile, events, per-tenant branding, offline support, and app store deployment.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 1. Project Setup

### 1.1 Initialize
- [x] ✅ Create `packages/mobile` with Expo + React Native
- [x] ✅ Configure Expo Router (file-based routing)
- [x] ✅ Install core dependencies (axios, zustand, tanstack-query, expo modules)
- [x] ✅ Configure TypeScript
- [x] ✅ Set up eas.json build profiles (development, preview, production)
- [x] ✅ Configure app.json (name, icon placeholder, splash screen)
- [x] ✅ Verify Expo Go works on iOS and Android devices

### 1.2 API Client
- [x] ✅ Create shared API client (axios with token interceptor)
- [x] ✅ Configure base URL (environment-based)
- [x] ✅ Implement token refresh interceptor
- [x] ✅ Create API service modules (auth, bookings, services, memberships, events)

---

## 2. Authentication

### 2.1 Auth Screens
- [x] ✅ Create login screen (email/password form)
- [x] ✅ Create register screen
- [x] ✅ Create forgot password screen
- [x] ✅ Create MFA code entry screen

### 2.2 OAuth Integration
- [x] ✅ Implement Google Sign-In (native SDK)
- [x] ✅ Implement Apple Sign-In (iOS required)
- [x] ✅ Handle OAuth token exchange with backend

### 2.3 Token Management
- [x] ✅ Store tokens in expo-secure-store
- [x] ✅ Implement automatic token refresh
- [x] ✅ Implement biometric login (expo-local-authentication)
- [x] ✅ Implement sign-out (clear tokens + cache)

### 2.4 Auth State
- [x] ✅ Create authStore (Zustand)
- [x] ✅ Auto-check stored tokens on app launch
- [x] ✅ Route guard (redirect to login if unauthenticated)

---

## 3. Customer Dashboard

### 3.1 Dashboard Screen
- [x] ✅ Create home tab screen
- [x] ✅ Display greeting with customer name
- [x] ✅ Display active membership card (plan, status, credits)
- [x] ✅ Display next upcoming booking card
- [x] ✅ Display quick action buttons (Book, Check In, Events)
- [x] ✅ Display promotional banners (from tenant config)
- [x] ✅ Implement pull-to-refresh
- [x] ✅ Ensure < 2 second load time

---

## 4. Service Browsing and Booking

### 4.1 Service Catalog
- [x] ✅ Create services tab screen
- [x] ✅ Display categories as horizontal chips
- [x] ✅ Display service cards (image, name, duration, price)
- [x] ✅ Implement search by name
- [x] ✅ Implement filters (category, duration, price)
- [x] ✅ Create service detail screen (description, images, variants, staff)

### 4.2 Booking Flow
- [x] ✅ Create date picker (calendar view)
- [x] ✅ Fetch and display available time slots
- [x] ✅ Create staff selector (optional)
- [x] ✅ Display price breakdown (base, discount, tax, total)
- [x] ✅ Implement slot hold during checkout
- [x] ✅ Integrate payment (card, Apple Pay, Google Pay)
- [x] ✅ Display confirmation screen
- [x] ✅ Add "Add to Calendar" action (expo-calendar)

---

## 5. Booking Management

### 5.1 My Bookings Screen
- [x] ✅ Create bookings tab screen
- [x] ✅ Display upcoming bookings list (sorted by date)
- [x] ✅ Display past bookings list (collapsible)
- [x] ✅ Create booking detail screen

### 5.2 Booking Actions
- [x] ✅ Implement cancel booking (with policy + fee display)
- [x] ✅ Implement reschedule (new date/time picker)
- [x] ✅ Implement add to device calendar
- [x] ✅ Display directions link (open maps app)

---

## 6. Membership Management

### 6.1 Membership Screen
- [x] ✅ Create membership screen
- [x] ✅ Display active plan card (name, status, renewal, credits)
- [x] ✅ Display credit balance with progress visualization
- [x] ✅ Display credit transaction history
- [x] ✅ Display plan benefits list

### 6.2 Membership Actions
- [x] ✅ Implement browse available plans
- [x] ✅ Implement purchase new membership (payment flow)
- [x] ✅ Implement upgrade/downgrade (proration display)
- [x] ✅ Implement pause membership
- [x] ✅ Implement cancel membership (confirmation + implications)

---

## 7. In-App Payments

### 7.1 Payment Integration
- [x] ✅ Integrate Stripe React Native SDK (or equivalent)
- [x] ✅ Implement Apple Pay (iOS)
- [x] ✅ Implement Google Pay (Android)
- [x] ✅ Implement stored card payment
- [x] ✅ Implement add new payment method
- [x] ✅ Implement discount code application
- [x] ✅ Display payment confirmation + receipt

---

## 8. Push Notifications

### 8.1 Setup
- [x] ✅ Configure expo-notifications
- [x] ✅ Request notification permissions on login
- [x] ✅ Register device token with backend (POST /api/v1/notifications/register)
- [x] ✅ Handle token refresh

### 8.2 Notification Handling
- [x] ✅ Handle foreground notifications (in-app banner)
- [x] ✅ Handle background notifications (system tray)
- [x] ✅ Handle notification tap (deep link to relevant screen)
- [x] ✅ Implement notification preferences screen
- [x] ✅ Implement in-app notification center (history)
- [x] ✅ Display badge count on app icon

---

## 9. QR Code Check-In

### 9.1 QR Display
- [x] ✅ Create check-in screen
- [x] ✅ Display booking QR code (large, full brightness)
- [x] ✅ Display persistent customer QR code
- [x] ✅ Show next booking info below QR
- [x] ✅ Support offline QR display (cached)

### 9.2 QR Scanning
- [x] ✅ Implement camera scanner (expo-barcode-scanner)
- [x] ✅ Scan venue QR → trigger self-check-in API
- [x] ✅ Display success/failure result

---

## 10. Profile Management

### 10.1 Profile Screen
- [x] ✅ Create profile tab screen
- [x] ✅ Display personal info (editable: name, email, phone, DOB)
- [x] ✅ Support profile photo (camera or gallery)
- [x] ✅ Implement change password
- [x] ✅ Implement notification preferences toggles
- [x] ✅ Display stored payment methods (add/remove)
- [x] ✅ Implement language selection
- [x] ✅ Implement sign out

### 10.2 Privacy & Data
- [x] ✅ Implement data export request (GDPR)
- [x] ✅ Implement account deletion request (GDPR)
- [x] ✅ Display privacy policy and terms links

---

## 11. Events and Workshops

### 11.1 Events Screen
- [x] ✅ Create events tab section
- [x] ✅ Display upcoming events (cards with image, title, date, availability)
- [x] ✅ Implement filters (type, date, availability)
- [x] ✅ Create event detail screen (description, facilitator, pricing)

### 11.2 Event Registration
- [x] ✅ Implement ticket tier selection
- [x] ✅ Implement registration payment flow
- [x] ✅ Display registered events in bookings/calendar view
- [x] ✅ Implement cancel registration

---

## 12. Per-Tenant Branding

### 12.1 Theme System
- [x] ✅ Create ThemeProvider context
- [x] ✅ Fetch branding config on login (colors, logo, font)
- [x] ✅ Apply primary/secondary/accent colors to all components
- [x] ✅ Display tenant logo on login + navigation header
- [x] ✅ Cache branding in AsyncStorage for offline

### 12.2 Tenant Selection
- [x] ✅ Create tenant selector screen (first launch)
- [x] ✅ Support search by business name or code entry
- [x] ✅ Store selected tenant_id persistently
- [x] ✅ Skip selection on subsequent launches

---

## 13. Offline Support

### 13.1 Caching
- [x] ✅ Cache upcoming bookings in AsyncStorage
- [x] ✅ Cache membership status + credits
- [x] ✅ Cache QR code data
- [x] ✅ Cache tenant branding

### 13.2 Offline UX
- [x] ✅ Display offline indicator banner
- [x] ✅ Disable network-required actions when offline
- [x] ✅ Queue offline actions (cancel, etc.) for sync
- [x] ✅ Sync on connectivity restore (NetInfo listener)

---

## 14. App Store Deployment

### 14.1 Build Pipeline
- [x] ✅ Configure EAS Build for iOS and Android
- [x] ✅ Generate app icons and splash screens
- [x] ✅ Configure app signing (iOS certificates, Android keystore)
- [x] ✅ Create preview builds for TestFlight + Internal Track
- [x] ✅ Test on real devices via TestFlight/Internal Track

### 14.2 Store Submission
- [x] ✅ Prepare App Store metadata (screenshots, description, keywords)
- [x] ✅ Prepare Play Store metadata (screenshots, description, content rating)
- [x] ✅ Submit to App Store Connect for review
- [x] ✅ Submit to Google Play Console for review
- [x] ✅ Configure OTA updates (eas update)
- [x] ✅ Configure staged rollout

---

## 15. Testing

### 15.1 Development Testing
- [x] ✅ Test all screens via Expo Go on physical devices
- [x] ✅ Test authentication flow (login, OAuth, biometric, MFA)
- [x] ✅ Test booking flow end-to-end
- [x] ✅ Test push notification delivery and deep links
- [x] ✅ Test QR code display and scanning
- [x] ✅ Test offline mode (airplane mode scenarios)
- [x] ✅ Test payment flows (sandbox/test cards)

### 15.2 Device Testing
- [x] ✅ Test on iOS (iPhone, various screen sizes)
- [x] ✅ Test on Android (multiple manufacturers, screen sizes)
- [x] ✅ Test on older OS versions (iOS 15, Android 10)
- [x] ✅ Test low-connectivity scenarios (3G, intermittent)
- [x] ✅ Performance profiling (< 2s dashboard load)
