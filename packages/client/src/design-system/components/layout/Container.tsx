import { ReactNode } from 'react';

interface ContainerProps {
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'full';
  className?: string;
}

const sizeMap = {
  sm: '640px',
  md: '768px',
  lg: '1280px',
  full: '100%',
};

export function Container({ children, size = 'lg', className }: ContainerProps) {
  return (
    <div
      className={className}
      style={{
        maxWidth: sizeMap[size],
        marginLeft: 'auto',
        marginRight: 'auto',
        paddingLeft: 'var(--page-padding-mobile)',
        paddingRight: 'var(--page-padding-mobile)',
      }}
    >
      {children}
    </div>
  );
}
