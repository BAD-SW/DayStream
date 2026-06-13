import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ReactNode } from 'react';
import { ThemeProvider, useTheme } from '../src/design-system/themes/ThemeProvider';
import { AuthProvider } from '../src/context/AuthContext';

// Mock the API client
vi.mock('../src/api/client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: { data: {} } }),
    post: vi.fn().mockResolvedValue({ data: { data: {} } }),
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <ThemeProvider>{children}</ThemeProvider>
    </AuthProvider>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to dark mode', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.mode).toBe('dark');
  });

  it('toggles between dark and light', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.mode).toBe('dark');

    act(() => { result.current.toggleMode(); });
    expect(result.current.mode).toBe('light');

    act(() => { result.current.toggleMode(); });
    expect(result.current.mode).toBe('dark');
  });

  it('persists mode to localStorage', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => { result.current.toggleMode(); });
    expect(localStorage.getItem('theme-mode')).toBe('light');
  });

  it('reads persisted mode from localStorage', () => {
    localStorage.setItem('theme-mode', 'light');
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.mode).toBe('light');
  });

  it('sets data-theme attribute on document', () => {
    renderHook(() => useTheme(), { wrapper });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('businessTheme is null when no user', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.businessTheme).toBeNull();
  });
});
