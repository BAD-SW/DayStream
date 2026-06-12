import { useAuth } from '../context/AuthContext';

/**
 * Hook to check if a feature flag is enabled.
 * Reads from the auth context (flags loaded on login).
 */
export function useFeatureFlag(key: string): boolean {
  const { featureFlags } = useAuth();
  return featureFlags[key] ?? false;
}
