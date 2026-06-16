import { Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AdminLayout } from './components/AdminLayout';
import { Login } from './pages/Login';
import { Profile } from './pages/Profile';
import { AdminDashboard } from './pages/AdminDashboard';
import { QueryEditorPage } from './pages/QueryEditorPage';
import { PersonaDashboard } from './design-system/components/dashboard/PersonaDashboard';

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
