import { Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AdminLayout } from './components/AdminLayout';
import { Login } from './pages/Login';
import { Profile } from './pages/Profile';
import { AdminDashboard } from './pages/AdminDashboard';
import { Tenants } from './pages/Tenants';
import { AdminConfig } from './pages/AdminConfig';
import { AdminUsers } from './pages/AdminUsers';
import { AuditLog } from './pages/AuditLog';
import { QueryEditorPage } from './pages/QueryEditorPage';
import { PersonaDashboard } from './design-system/components/dashboard/PersonaDashboard';
import { TenantBusinesses } from './pages/TenantBusinesses';
import { TenantBilling } from './pages/TenantBilling';
import { TenantReports } from './pages/TenantReports';
import { TenantUsers } from './pages/TenantUsers';
import { Customers } from './pages/Customers';
import { CustomerCreate } from './pages/CustomerCreate';
import { CustomerDetail } from './pages/CustomerDetail';
import { Segments } from './pages/Segments';
import { CustomerImport } from './pages/CustomerImport';
import { Services } from './pages/Services';
import { ServiceDetail } from './pages/ServiceDetail';
import { MerchandiseDetail } from './pages/MerchandiseDetail';
import { ServiceCreate } from './pages/ServiceCreate';
import { ServiceCategories } from './pages/ServiceCategories';
import { Bookings } from './pages/Bookings';
import { BookingCalendar } from './pages/BookingCalendar';
import { BookingFlow } from './pages/BookingFlow';
import { BookingCreate } from './pages/BookingCreate';
import { BookingEdit } from './pages/BookingEdit';
import { Memberships } from './pages/Memberships';
import { MembershipDetail } from './pages/MembershipDetail';
import { MembershipPlans } from './pages/MembershipPlans';
import { PricingRules } from './pages/PricingRules';
import { DiscountCodes } from './pages/DiscountCodes';
import { Payments } from './pages/Payments';
import { Payroll } from './pages/Payroll';
import { AccountsPayable } from './pages/AccountsPayable';
import { Staff } from './pages/Staff';
import { Business } from './pages/Business';
import { StaffCreate } from './pages/StaffCreate';
import { StaffDetail } from './pages/StaffDetail';
import { StaffLeave } from './pages/StaffLeave';
import { StaffCalendar } from './pages/StaffCalendar';
import { Resources } from './pages/Resources';
import { ResourceDetail } from './pages/ResourceDetail';
import { ResourceCreate } from './pages/ResourceCreate';
import { ResourceCalendar } from './pages/ResourceCalendar';
import { Events } from './pages/Events';
import { EventDetail } from './pages/EventDetail';
import { EventCreate } from './pages/EventCreate';
import { CheckIn } from './pages/CheckIn';
import { Marketing } from './pages/Marketing';
import { CampaignCreate } from './pages/CampaignCreate';
import { CampaignDetail } from './pages/CampaignDetail';
import { SequenceCreate } from './pages/SequenceCreate';
import { SequenceDetail } from './pages/SequenceDetail';
import { Reports } from './pages/Reports';
import { ReportView } from './pages/ReportView';
import { ScheduledReports } from './pages/ScheduledReports';
import { CMS } from './pages/CMS';
import { CMSBlog } from './pages/CMSBlog';
import { CMSMedia } from './pages/CMSMedia';
import { CMSPageEditor } from './pages/CMSPageEditor';
import { Integrations } from './pages/Integrations';
import { Community } from './pages/Community';
import { BusinessSettings } from './pages/BusinessSettings';
import { Locations } from './pages/Locations';
import { LocationDetail } from './pages/LocationDetail';
import { LocationCreate } from './pages/LocationCreate';

export function App() {
  return (
    <ErrorBoundary>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />

        {/* Main dashboard — persona-based */}
        <Route path="/dashboard" element={<ProtectedRoute><PersonaDashboard /></ProtectedRoute>} />

        {/* Protected app routes */}
        <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />

        {/* Customers */}
        <Route path="/customers" element={<ProtectedRoute><Customers /></ProtectedRoute>} />
        <Route path="/customers/new" element={<ProtectedRoute><CustomerCreate /></ProtectedRoute>} />
        <Route path="/customers/import" element={<ProtectedRoute><CustomerImport /></ProtectedRoute>} />
        <Route path="/customers/segments" element={<ProtectedRoute><Segments /></ProtectedRoute>} />
        <Route path="/customers/:id" element={<ProtectedRoute><CustomerDetail /></ProtectedRoute>} />

        {/* Offerings (Phase 28) */}
        <Route path="/offers" element={<ProtectedRoute><Services /></ProtectedRoute>} />
        <Route path="/offers/categories" element={<ProtectedRoute><ServiceCategories /></ProtectedRoute>} />
        <Route path="/offers/merchandise/:id" element={<ProtectedRoute><MerchandiseDetail /></ProtectedRoute>} />
        <Route path="/offers/memberships/:id" element={<ProtectedRoute><MembershipDetail /></ProtectedRoute>} />
        <Route path="/offers/services/:id" element={<ProtectedRoute><ServiceDetail /></ProtectedRoute>} />

        {/* Legacy service routes (redirect-compatible) */}
        <Route path="/services" element={<ProtectedRoute><Services /></ProtectedRoute>} />
        <Route path="/services/new" element={<ProtectedRoute><ServiceCreate /></ProtectedRoute>} />
        <Route path="/services/categories" element={<ProtectedRoute><ServiceCategories /></ProtectedRoute>} />
        <Route path="/services/:id" element={<ProtectedRoute><ServiceDetail /></ProtectedRoute>} />

        {/* Bookings */}
        <Route path="/bookings" element={<ProtectedRoute><Bookings /></ProtectedRoute>} />
        <Route path="/bookings/new" element={<ProtectedRoute><BookingCreate /></ProtectedRoute>} />
        <Route path="/bookings/:id/edit" element={<ProtectedRoute><BookingEdit /></ProtectedRoute>} />
        <Route path="/bookings/calendar" element={<ProtectedRoute><BookingCalendar /></ProtectedRoute>} />
        <Route path="/book/:serviceSlug" element={<ProtectedRoute><BookingFlow /></ProtectedRoute>} />

        {/* Memberships */}
        <Route path="/memberships" element={<ProtectedRoute><Memberships /></ProtectedRoute>} />
        <Route path="/memberships/plans" element={<ProtectedRoute><MembershipPlans /></ProtectedRoute>} />
        <Route path="/memberships/:id" element={<ProtectedRoute><MembershipDetail /></ProtectedRoute>} />

        {/* Pricing */}
        <Route path="/pricing" element={<ProtectedRoute><PricingRules /></ProtectedRoute>} />
        <Route path="/pricing/rules" element={<ProtectedRoute><PricingRules /></ProtectedRoute>} />
        <Route path="/pricing/codes" element={<ProtectedRoute><DiscountCodes /></ProtectedRoute>} />

        {/* Payments */}
        <Route path="/payments" element={<ProtectedRoute><Payments /></ProtectedRoute>} />

        {/* Payroll & AP */}
        <Route path="/payroll" element={<ProtectedRoute><Payroll /></ProtectedRoute>} />
        <Route path="/ap" element={<ProtectedRoute><AccountsPayable /></ProtectedRoute>} />

        {/* Business (Staff, Resources, Locations) */}
        <Route path="/business" element={<ProtectedRoute><Business /></ProtectedRoute>} />

        {/* Staff Management */}
        <Route path="/staff" element={<ProtectedRoute><Staff /></ProtectedRoute>} />
        <Route path="/staff/new" element={<ProtectedRoute><StaffCreate /></ProtectedRoute>} />
        <Route path="/staff/leave" element={<ProtectedRoute><StaffLeave /></ProtectedRoute>} />
        <Route path="/staff/calendar" element={<ProtectedRoute><StaffCalendar /></ProtectedRoute>} />
        <Route path="/staff/:id" element={<ProtectedRoute><StaffDetail /></ProtectedRoute>} />

        {/* Resource Management */}
        <Route path="/resources" element={<ProtectedRoute><Resources /></ProtectedRoute>} />
        <Route path="/resources/new" element={<ProtectedRoute><ResourceCreate /></ProtectedRoute>} />
        <Route path="/resources/calendar" element={<ProtectedRoute><ResourceCalendar /></ProtectedRoute>} />
        <Route path="/resources/:id" element={<ProtectedRoute><ResourceDetail /></ProtectedRoute>} />

        {/* Events & Workshops */}
        <Route path="/events" element={<ProtectedRoute><Events /></ProtectedRoute>} />
        <Route path="/events/new" element={<ProtectedRoute><EventCreate /></ProtectedRoute>} />
        <Route path="/events/:id" element={<ProtectedRoute><EventDetail /></ProtectedRoute>} />

        {/* Check-In */}
        <Route path="/check-in" element={<ProtectedRoute><CheckIn /></ProtectedRoute>} />

        {/* Marketing */}
        <Route path="/marketing" element={<ProtectedRoute><Marketing /></ProtectedRoute>} />
        <Route path="/marketing/campaigns/new" element={<ProtectedRoute><CampaignCreate /></ProtectedRoute>} />
        <Route path="/marketing/campaigns/:id" element={<ProtectedRoute><CampaignDetail /></ProtectedRoute>} />
        <Route path="/marketing/sequences/new" element={<ProtectedRoute><SequenceCreate /></ProtectedRoute>} />
        <Route path="/marketing/sequences/:id" element={<ProtectedRoute><SequenceDetail /></ProtectedRoute>} />

        {/* Reports */}
        <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
        <Route path="/reports/revenue" element={<ProtectedRoute><ReportView /></ProtectedRoute>} />
        <Route path="/reports/bookings" element={<ProtectedRoute><ReportView /></ProtectedRoute>} />
        <Route path="/reports/memberships" element={<ProtectedRoute><ReportView /></ProtectedRoute>} />
        <Route path="/reports/staff" element={<ProtectedRoute><ReportView /></ProtectedRoute>} />
        <Route path="/reports/customers" element={<ProtectedRoute><ReportView /></ProtectedRoute>} />
        <Route path="/reports/financial" element={<ProtectedRoute><ReportView /></ProtectedRoute>} />
        <Route path="/reports/scheduled" element={<ProtectedRoute><ScheduledReports /></ProtectedRoute>} />

        {/* CMS */}
        <Route path="/cms" element={<ProtectedRoute><CMS /></ProtectedRoute>} />
        <Route path="/cms/blog" element={<ProtectedRoute><CMSBlog /></ProtectedRoute>} />
        <Route path="/cms/media" element={<ProtectedRoute><CMSMedia /></ProtectedRoute>} />
        <Route path="/cms/pages/:id" element={<ProtectedRoute><CMSPageEditor /></ProtectedRoute>} />

        {/* Integrations */}
        <Route path="/integrations" element={<ProtectedRoute><Integrations /></ProtectedRoute>} />

        {/* Business Settings */}
        <Route path="/settings" element={<ProtectedRoute><BusinessSettings /></ProtectedRoute>} />
        <Route path="/settings/locations" element={<ProtectedRoute><Locations /></ProtectedRoute>} />
        <Route path="/settings/locations/new" element={<ProtectedRoute><LocationCreate /></ProtectedRoute>} />
        <Route path="/settings/locations/:id" element={<ProtectedRoute><LocationDetail /></ProtectedRoute>} />

        {/* Community */}
        <Route path="/community" element={<ProtectedRoute><Community /></ProtectedRoute>} />

        {/* Query Editor — restricted to system_admin and tenant_owner */}
        <Route
          path="/query-editor"
          element={
            <ProtectedRoute requiredRole="Manager" layout="none">
              <AdminLayout><QueryEditorPage /></AdminLayout>
            </ProtectedRoute>
          }
        />

        {/* Admin routes */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute requiredRole="Manager" layout="none">
              <AdminLayout><AdminDashboard /></AdminLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/tenants"
          element={
            <ProtectedRoute requiredRole="Manager" layout="none">
              <AdminLayout><Tenants /></AdminLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/config"
          element={
            <ProtectedRoute requiredRole="Manager" layout="none">
              <AdminLayout><AdminConfig /></AdminLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin/audit-log"
          element={
            <ProtectedRoute requiredRole="Manager" layout="none">
              <AdminLayout><AuditLog /></AdminLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute requiredRole="Manager" layout="none">
              <AdminLayout><AdminUsers /></AdminLayout>
            </ProtectedRoute>
          }
        />

        {/* Tenant routes */}
        <Route
          path="/admin/businesses"
          element={
            <ProtectedRoute requiredRole="Manager" layout="none">
              <AdminLayout><TenantBusinesses /></AdminLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/tenant-users"
          element={
            <ProtectedRoute requiredRole="Manager" layout="none">
              <AdminLayout><TenantUsers /></AdminLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/billing"
          element={
            <ProtectedRoute requiredRole="Manager" layout="none">
              <AdminLayout><TenantBilling /></AdminLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/reports"
          element={
            <ProtectedRoute requiredRole="Manager" layout="none">
              <AdminLayout><TenantReports /></AdminLayout>
            </ProtectedRoute>
          }
        />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
