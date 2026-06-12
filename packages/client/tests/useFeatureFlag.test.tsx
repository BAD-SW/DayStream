import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ReactNode } from 'react';
import { useFeatureFlag } from '../src/hooks/useFeatureFlag';

// Mock the auth context
const mockFeatureFlags: Record<string, boolean> = {
  'feature.online_booking': true,
  'feature.waitlist': true,
  'feature.loyalty_points': false,
};

vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '1', email: 'test@test.com', first_name: 'Test', last_name: 'User', role: 'customer' },
    isLoading: false,
    isAuthenticated: true,
    featureFlags: mockFeatureFlags,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

describe('useFeatureFlag', () => {
  it('returns true for enabled flag', () => {
    const { result } = renderHook(() => useFeatureFlag('feature.online_booking'));
    expect(result.current).toBe(true);
  });

  it('returns false for disabled flag', () => {
    const { result } = renderHook(() => useFeatureFlag('feature.loyalty_points'));
    expect(result.current).toBe(false);
  });

  it('returns false for unknown flag', () => {
    const { result } = renderHook(() => useFeatureFlag('feature.nonexistent'));
    expect(result.current).toBe(false);
  });
});
