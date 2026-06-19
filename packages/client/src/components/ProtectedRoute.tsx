import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LoadingSpinner } from './LoadingSpinner';
import { AppLayout } from './AppLayout';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: string;
  layout?: 'app' | 'admin' | 'none';
}

/**
 * Route guard that checks authentication and optionally role.
 * Stores the attempted URL so the user can be redirected after login.
 */
export function ProtectedRoute({ children, requiredRole, layout = 'app' }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1A1A1A' }}>
        <LoadingSpinner />
      </div>
    );
  }

  if (!isAuthenticated) {
    // Store redirect URL
    sessionStorage.setItem('redirectAfterLogin', location.pathname);
    return <Navigate to="/login" replace />;
  }

  if (requiredRole) {
    const userRole = user?.role || '';
    // Allow both database column values (snake_case) and roles table names (display format)
    const elevatedRoles = ['Super Admin', 'system_admin', 'system_support', 'Business Owner', 'business_owner', 'tenant_owner'];
    const hasAccess = userRole === requiredRole || elevatedRoles.includes(userRole);
    if (!hasAccess) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  if (layout === 'app') {
    return <AppLayout>{children}</AppLayout>;
  }

  // For admin or none, return children directly (wrapped by caller)
  return <>{children}</>;
}
