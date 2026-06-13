import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Table } from '../src/design-system/components/data/Table';

const columns = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'email', header: 'Email' },
  { key: 'role', header: 'Role' },
];

const data = [
  { id: '1', name: 'Alice', email: 'alice@test.com', role: 'Owner' },
  { id: '2', name: 'Bob', email: 'bob@test.com', role: 'Staff' },
  { id: '3', name: 'Carol', email: 'carol@test.com', role: 'Customer' },
];

describe('Table', () => {
  it('renders column headers', () => {
    render(<MemoryRouter><Table columns={columns} data={data} /></MemoryRouter>);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Role')).toBeInTheDocument();
  });

  it('renders data rows', () => {
    render(<MemoryRouter><Table columns={columns} data={data} /></MemoryRouter>);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('bob@test.com')).toBeInTheDocument();
    expect(screen.getByText('Customer')).toBeInTheDocument();
  });

  it('shows empty message when no data', () => {
    render(<MemoryRouter><Table columns={columns} data={[]} emptyMessage="Nothing here" /></MemoryRouter>);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('calls onSort when sortable column clicked', () => {
    const onSort = vi.fn();
    render(<MemoryRouter><Table columns={columns} data={data} onSort={onSort} /></MemoryRouter>);
    fireEvent.click(screen.getByText('Name'));
    expect(onSort).toHaveBeenCalledWith('name', 'asc');
  });

  it('renders pagination when page/totalPages provided', () => {
    const onPageChange = vi.fn();
    render(
      <MemoryRouter>
        <Table columns={columns} data={data} page={1} totalPages={3} onPageChange={onPageChange} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Next →'));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('renders checkboxes when selectable', () => {
    const onSelectionChange = vi.fn();
    render(
      <MemoryRouter>
        <Table columns={columns} data={data} selectable selectedIds={[]} onSelectionChange={onSelectionChange} />
      </MemoryRouter>,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(4); // 1 select-all + 3 rows
  });

  it('toggles row selection', () => {
    const onSelectionChange = vi.fn();
    render(
      <MemoryRouter>
        <Table columns={columns} data={data} selectable selectedIds={[]} onSelectionChange={onSelectionChange} />
      </MemoryRouter>,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]); // Click first row checkbox
    expect(onSelectionChange).toHaveBeenCalledWith(['1']);
  });

  it('shows loading state', () => {
    const { container } = render(<MemoryRouter><Table columns={columns} data={[]} loading /></MemoryRouter>);
    expect(container.querySelector('table')).toBeNull();
  });
});
