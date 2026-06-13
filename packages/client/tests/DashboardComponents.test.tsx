import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { KpiCard } from '../src/design-system/components/dashboard/KpiCard';
import { ModuleTile } from '../src/design-system/components/dashboard/ModuleTile';

describe('KpiCard', () => {
  it('renders label and value', () => {
    render(<KpiCard icon="📅" label="Bookings" value={12} />);
    expect(screen.getByText('Bookings')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('renders trend indicator', () => {
    render(<KpiCard icon="💰" label="Revenue" value="€4,250" trend={{ direction: 'up', percentage: 12, period: 'vs last week' }} />);
    expect(screen.getByText(/12%/)).toBeInTheDocument();
    expect(screen.getByText(/vs last week/)).toBeInTheDocument();
  });

  it('renders icon', () => {
    render(<KpiCard icon="📅" label="Test" value="0" />);
    expect(screen.getByText('📅')).toBeInTheDocument();
  });
});

describe('ModuleTile', () => {
  it('renders title and description', () => {
    render(
      <MemoryRouter>
        <ModuleTile id="test" icon="📅" title="Bookings" description="Manage bookings" path="/bookings" />
      </MemoryRouter>,
    );
    expect(screen.getByText('Bookings')).toBeInTheDocument();
    expect(screen.getByText('Manage bookings')).toBeInTheDocument();
  });

  it('renders badge when provided', () => {
    render(
      <MemoryRouter>
        <ModuleTile id="test" icon="📅" title="Bookings" description="desc" path="/bookings" badge="5" />
      </MemoryRouter>,
    );
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('applies disabled style', () => {
    render(
      <MemoryRouter>
        <ModuleTile id="test" icon="📅" title="Bookings" description="desc" path="/bookings" disabled />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-disabled', 'true');
  });
});
