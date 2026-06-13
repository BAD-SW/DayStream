import { ReactNode } from 'react';

interface StackProps {
  children: ReactNode;
  direction?: 'vertical' | 'horizontal';
  gap?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  align?: 'start' | 'center' | 'end' | 'stretch';
  className?: string;
}

const gapMap = {
  xs: 'var(--space-xs)',
  sm: 'var(--space-sm)',
  md: 'var(--space-md)',
  lg: 'var(--space-lg)',
  xl: 'var(--space-xl)',
};

export function Stack({ children, direction = 'vertical', gap = 'md', align = 'stretch', className }: StackProps) {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: direction === 'vertical' ? 'column' : 'row',
        gap: gapMap[gap],
        alignItems: align,
      }}
    >
      {children}
    </div>
  );
}
