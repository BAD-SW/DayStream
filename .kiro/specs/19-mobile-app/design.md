# Phase 19: Mobile Application - Design Document

**Date**: June 17, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 00, Phase 02, Phase 03–10, Phase 14, Phase 15

---

## Overview

This document describes the technical design for the DayStream mobile application — a cross-platform React Native + Expo app for iOS and Android. The app provides customer-facing functionality (booking, memberships, check-in, events, payments, push notifications) with per-tenant branding from a single binary. Development and testing use Expo Go for instant on-device testing without store deployment.

---

## Table of Contents

1. [Technology Stack](#1-technology-stack)
2. [Project Structure](#2-project-structure)
3. [Authentication Flow](#3-authentication-flow)
4. [Navigation Architecture](#4-navigation-architecture)
5. [State Management & Caching](#5-state-management--caching)
6. [Push Notifications](#6-push-notifications)
7. [Per-Tenant Branding](#7-per-tenant-branding)
8. [Offline Support](#8-offline-support)
9. [Key Screens](#9-key-screens)
10. [Testing & Deployment](#10-testing--deployment)

---

## 1. Technology Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Framework | React Native + Expo (SDK 52+) | Cross-platform, OTA updates, Expo Go for dev |
| Navigation | Expo Router (file-based) | Convention-over-config, deep linking built-in |
| State | Zustand + React Query (TanStack) | Lightweight global state + server cache |
| Storage | expo-secure-store (tokens), AsyncStorage (cache) | Secure credential storage |
| HTTP | Axios | Same client as web app, interceptors |
| Push | expo-notifications + FCM/APNs | Expo's unified push API |
| Payments | Stripe React Native SDK (or Expo pay module) | Apple Pay, Google Pay, cards |
| QR | expo-barcode-scanner + react-native-qrcode-svg | Scan + display |
| Biometrics | expo-local-authentication | Face ID, fingerprint |
| Images | expo-image (or FastImage) | Caching, progressive loading |
| Camera | expo-camera | QR scanning, photo upload |

---

## 2. Project Structure

```
packages/mobile/
├── app/                          # Expo Router file-based routes
│   ├── (auth)/                   # Auth screens (login, register)
│   │   ├── login.tsx
│   │   ├── register.tsx
│   │   └── forgot-password.tsx
│   ├── (tabs)/                   # Main tab navigator
│   │   ├── index.tsx             # Dashboard/Home
│   │   ├── bookings.tsx          # My Bookings
│   │   ├── services.tsx          # Browse & Book
│   │   ├── events.tsx            # Events
│   │   └── profile.tsx           # Profile & Settings
│   ├── booking/[id].tsx          # Booking detail
│   ├── service/[id].tsx          # Service detail + book
│   ├── event/[id].tsx            # Event detail + register
│   ├── checkin.tsx               # QR check-in screen
│   ├── membership.tsx            # Membership management
│   ├── notifications.tsx         # Notification center
│   └── _layout.tsx               # Root layout
├── components/                   # Shared UI components
├── hooks/                        # Custom hooks
├── services/                     # API client layer
├── store/                        # Zustand stores
├── theme/                        # Branding/theme resolver
├── utils/                        # Helpers
├── app.json                      # Expo config
├── eas.json                      # EAS Build config
└── package.json
```

---

## 3. Authentication Flow

```
App Launch
  ↓
Check SecureStore for tokens
  ├── Tokens found → validate (refresh if expired)
  │   ├── Valid → load tenant branding → navigate to Dashboard
  │   └── Invalid → clear tokens → Login screen
  └── No tokens → Login screen

Login Screen
  ├── Email + Password → POST /api/v1/auth/login
  ├── Google Sign-In → native SDK → POST /api/v1/auth/oauth/google
  ├── Apple Sign-In → native SDK → POST /api/v1/auth/oauth/apple
  └── MFA required → MFA code entry screen

After successful login:
  1. Store tokens in SecureStore
  2. Register push notification device token
  3. Load tenant branding config
  4. Navigate to Dashboard

Biometric login (returning user):
  1. Check biometric availability
  2. Prompt fingerprint/Face ID
  3. On success, retrieve tokens from SecureStore
  4. Proceed as normal authenticated session
```

---

## 4. Navigation Architecture

```
Root Stack Navigator
  ├── (auth) group — unauthenticated screens
  │   ├── Tenant Selector (first launch)
  │   ├── Login
  │   ├── Register
  │   └── Forgot Password
  └── (tabs) group — authenticated main app
      ├── Home (Dashboard)
      ├── Book (Services → Booking flow)
      ├── My Bookings
      ├── Events
      └── Profile

Modal Screens (overlay):
  ├── Check-In (QR display/scan)
  ├── Membership Management
  ├── Notification Center
  ├── Payment Method Management
  └── Booking Detail
```

Deep links map to Expo Router paths:
- `daystream://booking/abc123` → `/booking/abc123`
- `daystream://checkin` → `/checkin`
- `daystream://event/xyz` → `/event/xyz`

---

## 5. State Management & Caching

### Zustand Stores

- `authStore` — tokens, user info, tenant context
- `brandingStore` — cached tenant theme (colors, logo URL, font)
- `offlineStore` — cached bookings, membership, QR code

### React Query

All API data (services, bookings, events, membership) fetched via React Query with:
- Stale time: 5 minutes
- Cache time: 30 minutes
- Background refetch on app focus
- Optimistic updates for cancel/reschedule

### Offline Cache (AsyncStorage)

- Upcoming bookings (serialized)
- Membership status + credit balance
- QR code data (regenerated if expired)
- Tenant branding config

---

## 6. Push Notifications

### Registration Flow

```
On login:
  1. Request notification permissions (expo-notifications)
  2. Get Expo Push Token (or FCM/APNs token)
  3. POST /api/v1/notifications/register { device_token, platform, customer_id }
  4. Server stores token for future delivery
```

### Notification Types & Deep Links

| Type | Deep Link | Screen |
|------|-----------|--------|
| booking_confirmed | /booking/:id | Booking Detail |
| booking_reminder | /booking/:id | Booking Detail |
| booking_cancelled | /bookings | My Bookings |
| membership_renewal | /membership | Membership |
| credit_expiring | /membership | Membership |
| waitlist_available | /service/:id | Service (rebook) |
| marketing_campaign | /promotions | Dashboard or deep URL |
| event_reminder | /event/:id | Event Detail |

### In-App Notification Center

Stores notification history locally + syncs with server. Badge count on tab bar.

---

## 7. Per-Tenant Branding

### Runtime Theme Resolution

```
On login/tenant selection:
  1. Fetch tenant config: GET /api/v1/config/branding
  2. Receive: { primaryColor, secondaryColor, accentColor, logoUrl, fontFamily }
  3. Store in brandingStore (Zustand) + AsyncStorage (persist)
  4. Apply via React Native's StyleSheet or a ThemeProvider context
  5. All components consume colors from theme context
```

### Tenant Selection (First Launch)

If app is multi-tenant (single listing, many businesses):
- Customer enters a business code or searches by name
- App stores selected tenant_id
- Subsequent launches skip selection

---

## 8. Offline Support

### Cached Data (available without network)

- Next 7 days of bookings
- Active membership + credit balance
- Customer QR code (pre-generated, time-bounded)
- Tenant branding (logo, colors)

### Offline Indicators

- Banner: "You're offline — showing cached data"
- Grayed-out actions that require network (booking, payment)
- QR code remains fully functional offline

### Sync on Reconnect

- Detect connectivity change via NetInfo
- Flush queued actions (pending cancellation, etc.)
- Refresh stale cached data

---

## 9. Key Screens

### Dashboard (Home Tab)
- Greeting + membership badge
- Next booking card (tap to view details)
- Quick actions row (Book, Check In, Events)
- Credit balance (if applicable)
- Promotional banner (from tenant config)

### Service Catalog (Book Tab)
- Category chips (horizontal scroll)
- Service cards (image, name, duration, price)
- Search bar
- Tap → Service Detail → Book

### Booking Flow (Service Detail → Confirm)
- Date picker (calendar view)
- Available time slots (scrollable list)
- Staff selector (optional, avatar + name)
- Price summary
- Pay button (Apple Pay / Google Pay / card)
- Confirmation with "Add to Calendar" button

### My Bookings
- Upcoming list (cards with status badge)
- Past list (collapsible)
- Tap → Booking Detail (cancel, reschedule, directions)

### Check-In Screen
- Large QR code display (full brightness)
- "Scan venue code" button (opens camera)
- Next booking info below QR
- Works offline (cached QR)

### Membership
- Plan card (name, status, renewal date)
- Credit balance with progress ring
- Transaction history
- Actions: pause, upgrade, cancel

### Profile
- Personal info (editable)
- Notification preferences
- Payment methods
- Language selection
- Privacy (data export, delete account)
- Sign out

---

## 10. Testing & Deployment

### Development Testing

| Method | Platform | Setup |
|--------|----------|-------|
| Expo Go | iOS + Android | Scan QR code, instant reload |
| iOS Simulator | macOS | `npx expo start --ios` |
| Android Emulator | Any | `npx expo start --android` |

### Stakeholder Testing

| Method | Platform | Setup |
|--------|----------|-------|
| TestFlight | iOS | Upload via EAS Build → TestFlight invite |
| Internal Track | Android | Upload via EAS Build → Play Console internal |
| Direct APK | Android | Build APK → share file → sideload |

### Production Deployment

```
EAS Build pipeline:
  1. eas build --platform all --profile production
  2. Upload to App Store Connect + Google Play Console
  3. Submit for review
  4. Staged rollout (10% → 50% → 100%)

OTA Updates (non-native changes):
  1. eas update --branch production
  2. Users receive update on next app launch
  3. No store review needed
```

### Build Profiles (eas.json)

```json
{
  "build": {
    "development": { "developmentClient": true, "distribution": "internal" },
    "preview": { "distribution": "internal" },
    "production": { "autoIncrement": true }
  }
}
```

---

**Last Updated**: June 17, 2026
