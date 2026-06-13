interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  itemsPerPage?: number;
  itemsPerPageOptions?: number[];
  onItemsPerPageChange?: (limit: number) => void;
}

export function Pagination({ page, totalPages, onPageChange, itemsPerPage, itemsPerPageOptions, onItemsPerPageChange }: PaginationProps) {
  if (totalPages <= 1 && !itemsPerPageOptions) return null;

  const pages = getPageNumbers(page, totalPages);

  return (
    <nav aria-label="Pagination" style={styles.container}>
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        style={styles.button}
        aria-label="Previous page"
      >
        ←
      </button>

      {pages.map((p, i) => (
        p === '...' ? (
          <span key={`ellipsis-${i}`} style={styles.ellipsis}>…</span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p as number)}
            style={{ ...styles.button, ...(p === page ? styles.active : {}) }}
            aria-current={p === page ? 'page' : undefined}
          >
            {p}
          </button>
        )
      ))}

      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        style={styles.button}
        aria-label="Next page"
      >
        →
      </button>

      {itemsPerPageOptions && onItemsPerPageChange && (
        <select
          value={itemsPerPage}
          onChange={(e) => onItemsPerPageChange(Number(e.target.value))}
          style={styles.perPage}
          aria-label="Items per page"
        >
          {itemsPerPageOptions.map((opt) => (
            <option key={opt} value={opt}>{opt} / page</option>
          ))}
        </select>
      )}
    </nav>
  );
}

function getPageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 3) return [1, 2, 3, 4, '...', total];
  if (current >= total - 2) return [1, '...', total - 3, total - 2, total - 1, total];
  return [1, '...', current - 1, current, current + 1, '...', total];
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' },
  button: {
    background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
    color: 'var(--color-text)', padding: '6px 12px', fontSize: 'var(--font-size-sm)',
    cursor: 'pointer', minWidth: '36px', textAlign: 'center',
    fontFamily: 'var(--font-family)',
  },
  active: { background: 'var(--color-primary)', color: 'var(--color-primary-contrast)', borderColor: 'var(--color-primary)' },
  ellipsis: { color: 'var(--color-text-secondary)', padding: '0 4px' },
  perPage: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text)', padding: '4px 8px', fontSize: 'var(--font-size-xs)', marginLeft: 'var(--space-md)', fontFamily: 'var(--font-family)' },
};
