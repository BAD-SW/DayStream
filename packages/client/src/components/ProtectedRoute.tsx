import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useContextManager, resolvePersona, getPermissionsFromRole } from '../context/ContextManager';
import { mayOpenBusinessPath } from '../design-system/components/dashboard/moduleRegistry';
import { LoadingSpinner } from './LoadingSpinner';
import { AppLayout } from './AppLayout';

const CUSTOMER_PATHS = [/^\/dashboard$/, /^\/profile$/, /^\/bookings$/, /^\/events(\/(?!new$)[^/]+)?$/, /^\/community$/];

// Platform screens (DayStream's own staff) and organisation screens (a tenant's owner). A user
// below that level never sees them, even by typing the address: the server would refuse the
// data anyway, so the page would only be an empty shell.
const SYSTEM_PATHS = [/^\/query-editor/, /^\/admin$/, /^\/admin\/(tenants|config|system-reports|processes|audit-log|users|coverage-map|prospect-categories)(\/|$)/];
const TENANT_PATHS = [/^\/admin\//];

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
  const { isInitialising: contextInitialising } = useContextManager();
  const location = useLocation();

  // Wait on ContextManager too, not just AuthContext — otherwise AppLayout can render one
  // frame with the wrong (persona-default) contextLevel before a restored/switched context
  // is applied, flashing the wrong sidebar modules for a moment (Requirement 6.6).
  if (isLoading || (isAuthenticated && contextInitialising)) {
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

  // Customers only have self-service screens; every other route is a staff screen whose
  // API calls they are not permitted to make.
  if (resolvePersona(user?.role || '') === 'customer' && !CUSTOMER_PATHS.some((p) => p.test(location.pathname))) {
    return <Navigate to="/dashboard" replace />;
  }

  const persona = resolvePersona(user?.role || '');
  const isSystemPath = SYSTEM_PATHS.some((p) => p.test(location.pathname));
  if ((persona === 'tenant' && isSystemPath) || (persona === 'business' && (isSystemPath || TENANT_PATHS.some((p) => p.test(location.pathname))))) {
    return <Navigate to="/dashboard" replace />;
  }

  // Staff roles: a module their role has no permission for is not opened by its address either.
  if (persona === 'business' && !mayOpenBusinessPath(location.pathname, getPermissionsFromRole(user?.role || ''))) {
    return <Navigate to="/dashboard" replace />;
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
