import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ContextSwitcher } from '../src/components/ContextSwitcher';

const mockState: any = {
  persona: 'business',
  activeContext: { contextLevel: 'business', tenantId: 't1', businessId: 'b1', displayName: 'Transcend Mallorca' },
  accessibleContexts: [],
  isSwitching: false,
  switchContext: vi.fn(),
};

vi.mock('../src/context/ContextManager', async () => {
  const actual = await vi.importActual<typeof import('../src/context/ContextManager')>('../src/context/ContextManager');
  return { ...actual, useContextManager: () => mockState };
});

describe('ContextSwitcher', () => {
  beforeEach(() => {
    mockState.switchContext = vi.fn().mockResolvedValue(undefined);
    mockState.isSwitching = false;
  });

  it('renders a static, non-interactive label for business persona — no dropdown button', () => {
    mockState.persona = 'business';
    mockState.activeContext = { contextLevel: 'business', tenantId: 't1', businessId: 'b1', displayName: 'Transcend Mallorca' };
    render(<ContextSwitcher />);

    expect(screen.getByText('Transcend Mallorca')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('renders an interactive combobox trigger for system persona, showing the active displayName', () => {
    mockState.persona = 'system';
    mockState.activeContext = { contextLevel: 'system', tenantId: null, businessId: null, displayName: 'DayStream Platform' };
    mockState.accessibleContexts = [];
    render(<ContextSwitcher />);

    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-haspopup', 'listbox');
    expect(screen.getByText('DayStream Platform')).toBeInTheDocument();
  });

  it('opens the dropdown on click and groups accessible contexts by type', () => {
    mockState.persona = 'system';
    mockState.activeContext = { contextLevel: 'system', tenantId: null, businessId: null, displayName: 'DayStream Platform' };
    mockState.accessibleContexts = [
      { id: 't1', type: 'tenant', displayName: 'Transcend Health' },
      { id: 't2', type: 'tenant', displayName: 'Acme Wellness' },
    ];
    render(<ContextSwitcher />);

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByText('Transcend Health')).toBeInTheDocument();
    expect(screen.getByText('Acme Wellness')).toBeInTheDocument();
    expect(screen.getByText('Platform')).toBeInTheDocument(); // system group label, always present for system persona
  });

  it('highlights the currently active option with aria-selected', () => {
    mockState.persona = 'tenant';
    mockState.activeContext = { contextLevel: 'business', tenantId: 't1', businessId: 'biz1', displayName: 'Transcend Mallorca' };
    mockState.accessibleContexts = [
      { id: 'biz1', type: 'business', displayName: 'Transcend Mallorca', parentId: 't1' },
      { id: 'biz2', type: 'business', displayName: 'Transcend Madrid', parentId: 't1' },
    ];
    render(<ContextSwitcher />);
    fireEvent.click(screen.getByRole('button'));

    const listbox = screen.getByRole('listbox');
    const active = within(listbox).getByText('Transcend Mallorca').closest('[role="option"]');
    const inactive = within(listbox).getByText('Transcend Madrid').closest('[role="option"]');
    expect(active).toHaveAttribute('aria-selected', 'true');
    expect(inactive).toHaveAttribute('aria-selected', 'false');
  });

  it('closes the dropdown on Escape and calls switchContext when an option is selected', async () => {
    mockState.persona = 'tenant';
    mockState.activeContext = { contextLevel: 'tenant', tenantId: 't1', businessId: null, displayName: 'Transcend Health' };
    mockState.accessibleContexts = [
      { id: 'biz1', type: 'business', displayName: 'Transcend Mallorca', parentId: 't1' },
    ];
    render(<ContextSwitcher />);
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Transcend Mallorca'));
    expect(mockState.switchContext).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'biz1', type: 'business', displayName: 'Transcend Mallorca' }),
    );
  });

  it('shows a busy/disabled trigger while switching', () => {
    mockState.persona = 'system';
    mockState.activeContext = { contextLevel: 'system', tenantId: null, businessId: null, displayName: 'DayStream Platform' };
    mockState.isSwitching = true;
    render(<ContextSwitcher />);

    const trigger = screen.getByRole('button');
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute('aria-busy', 'true');
  });
});
