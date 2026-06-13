import { ReactNode } from 'react';

interface GridProps {
  children: ReactNode;
  cols?: { sm?: number; md?: number; lg?: number; xl?: number };
  gap?: 'sm' | 'md' | 'lg';
  className?: string;
}

const gapMap = { sm: 'var(--space-sm)', md: 'var(--space-md)', lg: 'var(--space-lg)' };

export function Grid({ children, cols = { sm: 1, md: 2, lg: 3 }, gap = 'md', className }: GridProps) {
  return (
    <div
      className={className}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols.sm || 1}, 1fr)`,
        gap: gapMap[gap],
      }}
    >
      {children}
    </div>
  );
}
