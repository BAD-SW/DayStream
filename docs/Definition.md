Problem Statement:
I want to create an on-line booking/reservation management system that can be used for small businesses like spa’s, yoga studio’s, tour groups, dentists and similar.
·       This must be a multi-tenant, multi-language system.
·       It must have a complete financial package capable of taking payments, processing payroll, generating reports and such.
·       It needs to include a contact management system for customers.
·       Depending on the type of business, it may need to store associated information with a customer (for example personal consumer/patient information).
·       I want a consumer application that will allow consumers to see available time slots they can book directly.

Scope:
Modules commonly included or available
Online booking & scheduling
Membership management
Class packs and subscriptions
CRM / customer database
Email marketing
SMS marketing
Automated workflows ("Sequences")
Lead funnels
Point of Sale (POS)
Payment processing
Staff scheduling
Payroll tracking
Mobile apps
Video-on-demand library
Online courses / LMS
Reporting and analytics
Community feed & messaging
Whatsapp messaging

Like Systems:
Momence
bsport (French company, strong in Europe)
Momoyoga (very popular among yoga studios)
WellnessLiving
Mindbody
Virtuagym

Possible pricing scenarios


Plan Level
Approximate Monthly Cost
Starter Studio
€90–€150/month
Growing Studio
€150–€300/month
Multi-location
€300–€600+/month
Enterprise
Custom quote




ChatGPT POC Requirements

KIRO Requirements Specification
Project: DayStream (Momence-Class SaaS + Mobile App)
Vision
Develop a configurable wellness-business management platform inspired by Momence, Mindbody, Mariana Tek, Glofox, WellnessLiving, and similar systems, specifically tailored for recovery centers, wellness studios, health optimization centers, gyms, spas, clinics, and hybrid businesses.
The first implementation/customer is:
Transcend Health Mallorca
The platform must support Transcend's current business model while remaining fully configurable for future customers and verticals.
The project consists of:
Multi-tenant SaaS Platform (Web)
Staff/Admin Portal
Customer Portal
Native Mobile App (iOS & Android)
Website CMS Integration
Booking Engine
Membership & Subscription Engine
Payment & Commerce Platform
Reporting & Analytics
Marketing Automation & CRM

1. DESIGN SYSTEM REQUIREMENTS
Objective
Replicate the visual identity, premium feel and customer experience of the Transcend website while modernizing it for SaaS.
Design Characteristics
Based on the Transcend website: (Transcend)
Style
Luxury wellness
Premium recovery center
Scandinavian minimalism
Dark mode first
Clean typography
Large imagery
Wellness-focused atmosphere
Colors
Primary:
Black
Charcoal
Dark grey
Secondary:
White
Off-white
Light grey
Accent:
Warm gold
Bronze
Recovery blue
UI Components
Large hero banners
Card-based service presentation
Smooth transitions
Rounded corners
Mobile-first design
Large CTA buttons
Elegant dashboard widgets
Deliverables
Create reusable design system:
Color tokens
Typography tokens
Component library
Icon library
Dark/Light themes
Figma-compatible structure

2. MULTI-TENANT SAAS ARCHITECTURE
Goal
Single platform serving multiple businesses.
Tenant Features
Each business gets:
Custom branding
Custom domain
Custom services
Custom memberships
Custom pricing
Custom staff
Custom locations
Examples:
Tenant A:
Recovery center
Tenant B:
Yoga studio
Tenant C:
Fitness club
Tenant D:
Physiotherapy clinic
All sharing same backend.

3. CUSTOMER MANAGEMENT (CRM)
Customer Profiles
Store:
Personal Information
First name
Last name
Email
Mobile
Birthdate
Gender
Language
Country
Membership Data
Membership type
Join date
Status
Credits
Expiration
Booking Data
Upcoming bookings
Past bookings
Attendance history
Cancellations
No-shows
Financial Data
Purchases
Invoices
Payments
Refunds
Wellness Notes
Optional:
Goals
Injuries
Recovery focus
Preferences

4. SERVICES MANAGEMENT
Dynamic Service Engine
Admin creates:
Service Categories
Examples from Transcend:
Recovery Services
Fire & Ice Session
Infrared Sauna
Cold Water Therapy
Warm Water Therapy
Compression Therapy
Red Light Therapy
Treatments
Sports Massage
Float Tank
Coaching
One-on-One Gym
Events
Breath & Ice Workshops
Wellness Workshops
Future
Cryotherapy
Physiotherapy
Nutrition
Personal Training
Based on services shown on the Transcend site. (Transcend)
Service Configuration
Each service contains:
Name
Description
Images
Duration
Capacity
Staff assignment
Location assignment
Resources required
Pricing
Tax rules
Cancellation policy

5. BOOKING ENGINE
Core Requirement
Equivalent or superior to Momence booking flow.
Booking Types
Individual Appointment
Examples:
Massage
Float Tank
Personal Training
Shared Session
Examples:
Fire & Ice
Sauna
Group Class
Examples:
Workshops
Events
Resource Booking
Examples:
Float Room
Massage Room
Booking Rules
Configurable:
Lead time
Cut-off time
Capacity
Waitlist
Cancellation policy
Reschedule policy
Calendar Views
Day
Week
Month
Timeline
Resource calendar

6. MEMBERSHIP ENGINE
Membership Types
Unlimited Membership
Unlimited access.
Credit Membership
Example:
10 credits/month.
Hybrid Membership
Membership + credits.
Punch Cards
Examples:
5 sessions
10 sessions
20 sessions
Introductory Packages
Required for Transcend.
Examples found on website:
Fire & Ice Intro Pack
Float Tank Intro Pack
Red Light Therapy Intro Pack
(Transcend)
Membership Features
Auto-renew
Freeze membership
Pause membership
Upgrade
Downgrade
Family memberships

7. PRICING ENGINE
Dynamic Pricing
Support Transcend current pricing model.
Examples currently published:
Fire & Ice
30 min
60 min
90 min
Sports Massage
30 min
60 min
90 min
Red Light Therapy
10 min
20 min
Intro Packages
Various package structures.
(Transcend)
Pricing Rules
Support:
Fixed pricing
Membership pricing
Promotional pricing
Seasonal pricing
First-time customer pricing
Corporate pricing

8. PAYMENT PLATFORM
Payment Providers
Required:
Phase 1
Stripe
PayPal
Phase 2
GoCardless
SumUp
Adyen
Features
One-time payments
Subscriptions
Refunds
Gift cards
Gift vouchers
Stored payment methods

9. STAFF MANAGEMENT
Staff Profiles
Store:
Name
Photo
Bio
Qualifications
Certifications
Languages
Inspired by Transcend team profiles. (Transcend)
Staff Scheduling
Availability
Holidays
Sick leave
Capacity
Staff Permissions
Roles:
Super Admin
Platform owner
Business Owner
Tenant owner
Manager
Business management
Reception
Booking management
Therapist
Treatment management
Trainer
Training management

10. RESOURCE MANAGEMENT
Manage:
Rooms
Examples:
Float Room
Massage Room
Gym Room
Equipment
Examples:
Sauna
Cold Bath
Jacuzzi
Compression Boots
Red Light Cabin
Rules
Prevent double-booking.

11. EVENTS & WORKSHOPS
Support:
Events
Workshops
Seminars
Challenges
Retreats
Features
Capacity
Ticketing
Attendance
Waitlist
Check-in
Examples from Transcend workshops. (Transcend)

12. CHECK-IN SYSTEM
Methods
QR Code
Mobile App
Reception
Kiosk
Features
Attendance tracking
No-show tracking
Session validation

13. MARKETING CRM
Customer Segmentation
Filter by:
Membership
Attendance
Revenue
Last visit
Interests
Campaign Types
Email
SMS
Push notifications
Automations
Examples:
New Member
Welcome sequence
No Visit 30 Days
Re-engagement campaign
Membership Expiring
Renewal campaign
Birthday
Automatic offer

14. MOBILE APPLICATION
Purpose
Consumer-facing app.
Authentication
Email
Google
Apple
Dashboard
Display:
Membership
Credits
Upcoming bookings
Recent activity
Booking
Browse services
Book
Cancel
Reschedule
Membership
Purchase
Renew
Upgrade
Payments
Secure checkout
Stored cards
Notifications
Booking reminders
Membership alerts
Marketing notifications
Community
Phase 2:
Challenges
Leaderboards
Social engagement

15. WEBSITE CMS
Website Builder
Allow businesses to manage:
Homepage
Services
Pricing
Staff
Blog
FAQs
Gallery
Similar to Transcend's website structure. (Transcend)
SEO
Meta tags
Structured data
Sitemap
Open Graph

16. REPORTING & ANALYTICS
Business KPIs
Revenue
Daily
Weekly
Monthly
Memberships
Active
Churn
Renewals
Bookings
Utilization
Attendance
No-shows
Staff
Revenue per therapist
Occupancy
Productivity
Resources
Sauna utilization
Float room utilization
Massage room utilization

17. PLATFORM ADMIN (SUPER ADMIN)
SaaS Management
Manage:
Tenants
Billing
Usage
Support tickets
Feature flags
Subscription Plans
Starter
Professional
Business
Enterprise

18. API-FIRST REQUIREMENTS
All functionality exposed via APIs.
APIs
REST
GraphQL
Integrations
Stripe
Google Calendar
Outlook
Mailchimp
Klaviyo
Zapier
WhatsApp

19. AI FEATURES (DIFFERENTIATOR)
This is where the product can surpass Momence.
AI Booking Assistant
Answer:
Which service should I book?
When am I available?
Recommend recovery plans
AI Receptionist
Website chatbot:
Book sessions
Answer FAQs
Membership recommendations
AI Business Assistant
Owner dashboard:
Revenue insights
Churn prediction
Membership recommendations
Staff optimization

20. TECHNICAL STACK (RECOMMENDED FOR KIRO)
Frontend
Next.js
React
TypeScript
Tailwind
Mobile
React Native
Expo
Backend
NestJS
TypeScript
Database
PostgreSQL
Cache
Redis
Search
Elasticsearch/OpenSearch
Storage
AWS S3
Hosting
AWS
Auth
Auth0 or Cognito
Payments
Stripe

MVP ROADMAP
Phase 1 (POC for Transcend)
Customer management
Services management
Booking engine
Calendar
Payments
Memberships
Website integration
Mobile App v1
Transcend branding
Phase 2
CRM
Marketing automation
Gift cards
Workshops
Resource management
Phase 3
Full SaaS multi-tenant
AI assistant
White-label mobile app
Franchise support
This specification is detailed enough to serve as the master requirements document for KIRO and should result in a platform comparable to Momence, WellnessLiving, Glofox, Mariana Tek, and Mindbody, while being purpose-built for wellness, recovery, longevity, and health-optimization businesses such as Transcend.