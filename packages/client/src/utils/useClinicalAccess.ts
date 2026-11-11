import { useAuth } from '../context/AuthContext';
import { getPermissionsFromRole } from '../context/ContextManager';

/**
 * Whether the signed-in user may use treatment charts (spec 51, gap 2): owners, managers,
 * therapists and trainers, not reception. This only decides what the screens show; the server
 * is the authority and refuses everyone else.
 */
export function useClinicalAccess(): boolean {
  const { user } = useAuth();
  return getPermissionsFromRole(user?.role || '').some((p) => p === '*:*' || p === 'clinical:*');
}
