import { Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AdminLayout } from './components/AdminLayout';
import { Login } from './pages/Login';
import { Profile } from './pages/Profile';
import { AdminDashboard } from './pages/AdminDashboard';
import { QueryEditorPage } from './pages/QueryEditorPage';
import { PersonaDashboard } from './design-system/components/dashboard/PersonaDashboard';
import { Customers } from './pages/Customers';
import { CustomerCreate } from './pages/CustomerCreate';
import { CustomerDetail } from './pages/CustomerDetail';
import { Segments } from './pages/Segments';
import { CustomerImport } from './pages/CustomerImport';
import { Services } from './pages/Services';
import { ServiceDetail } from './pages/ServiceDetail';
import { ServiceCategories } from './pages/ServiceCategories';
import { Bookings } from './pages/Bookings';
import { BookingCalendar } from './pages/BookingCalendar';
import { BookingFlow } from './pages/BookingFlow';
import { Memberships } from './pages/Memberships';
import { MembershipPlans } from './pages/MembershipPlans';
import { PricingRules } from './pages/PricingRules';
import { DiscountCodes } from './pages/DiscountCodes';
import { Payroll } from './pages/Payroll';
import { AccountsPayable } from './pages/AccountsPayable';
import { Staff } from './pages/Staff';
import { StaffCreate } from './pages/StaffCreate';
import { StaffDetail } from './pages/StaffDetail';
import { StaffLeave } from './pages/StaffLeave';
import { StaffCalendar } from './pages/StaffCalendar';
import { Resources } from './pages/Resources';
import { ResourceDetail } from './pages/ResourceDetail';
import { ResourceCalendar } from './pages/ResourceCalendar';
import { Events } from './pages/Events';
import { EventDetail } from './pages/EventDetail';

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

        {/* Services */}
        <Route path="/services" element={<ProtectedRoute><Services /></ProtectedRoute>} />
        <Route path="/services/categories" element={<ProtectedRoute><ServiceCategories /></ProtectedRoute>} />
        <Route path="/services/:id" element={<ProtectedRoute><ServiceDetail /></ProtectedRoute>} />

        {/* Bookings */}
        <Route path="/bookings" element={<ProtectedRoute><Bookings /></ProtectedRoute>} />
        <Route path="/bookings/calendar" element={<ProtectedRoute><BookingCalendar /></ProtectedRoute>} />
        <Route path="/book/:serviceSlug" element={<ProtectedRoute><BookingFlow /></ProtectedRoute>} />

        {/* Memberships */}
        <Route path="/memberships" element={<ProtectedRoute><Memberships /></ProtectedRoute>} />
        <Route path="/memberships/plans" element={<ProtectedRoute><MembershipPlans /></ProtectedRoute>} />

        {/* Pricing */}
        <Route path="/pricing/rules" element={<ProtectedRoute><PricingRules /></ProtectedRoute>} />
        <Route path="/pricing/codes" element={<ProtectedRoute><DiscountCodes /></ProtectedRoute>} />

        {/* Payroll & AP */}
        <Route path="/payroll" element={<ProtectedRoute><Payroll /></ProtectedRoute>} />
        <Route path="/ap" element={<ProtectedRoute><AccountsPayable /></ProtectedRoute>} />

        {/* Staff Management */}
        <Route path="/staff" element={<ProtectedRoute><Staff /></ProtectedRoute>} />
        <Route path="/staff/new" element={<ProtectedRoute><StaffCreate /></ProtectedRoute>} />
        <Route path="/staff/leave" element={<ProtectedRoute><StaffLeave /></ProtectedRoute>} />
        <Route path="/staff/calendar" element={<ProtectedRoute><StaffCalendar /></ProtectedRoute>} />
        <Route path="/staff/:id" element={<ProtectedRoute><StaffDetail /></ProtectedRoute>} />

        {/* Resource Management */}
        <Route path="/resources" element={<ProtectedRoute><Resources /></ProtectedRoute>} />
        <Route path="/resources/calendar" element={<ProtectedRoute><ResourceCalendar /></ProtectedRoute>} />
        <Route path="/resources/:id" element={<ProtectedRoute><ResourceDetail /></ProtectedRoute>} />

        {/* Events & Workshops */}
        <Route path="/events" element={<ProtectedRoute><Events /></ProtectedRoute>} />
        <Route path="/events/:id" element={<ProtectedRoute><EventDetail /></ProtectedRoute>} />

        {/* Query Editor — restricted to system_admin and tenant_owner */}
        <Route
          path="/query-editor"
          element={
            <ProtectedRoute>
              <QueryEditorPage />
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

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
