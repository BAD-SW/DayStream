import { Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AdminLayout } from './components/AdminLayout';
import { Login } from './pages/Login';
import { Profile } from './pages/Profile';
import { AdminDashboard } from './pages/AdminDashboard';
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
