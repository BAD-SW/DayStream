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
