import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/context/AuthContext';
import { App } from '../src/App';

function renderApp(route = '/login') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('App', () => {
  it('renders login page by default', () => {
    renderApp('/login');
    expect(screen.getByText('DayStream')).toBeInTheDocument();
    expect(screen.getByText('Sign in to your account')).toBeInTheDocument();
  });

  it('shows email and password fields', () => {
    renderApp('/login');
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('has a sign in button', () => {
    renderApp('/login');
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('redirects to login when not authenticated', () => {
    localStorage.removeItem('access_token');
    renderApp('/dashboard');
    expect(screen.getByText('Sign in to your account')).toBeInTheDocument();
  });

  it('redirects admin routes to login when not authenticated', () => {
    localStorage.removeItem('access_token');
    renderApp('/admin');
    expect(screen.getByText('Sign in to your account')).toBeInTheDocument();
  });
});
