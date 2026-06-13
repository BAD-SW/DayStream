interface SkeletonProps {
  width?: string;
  height?: string;
  borderRadius?: string;
}

export function Skeleton({ width = '100%', height = '20px', borderRadius = 'var(--radius-md)' }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      style={{
        width,
        height,
        borderRadius,
        background: 'var(--color-surface-hover)',
        animation: 'pulse 1.5s ease-in-out infinite',
      }}
    />
  );
}
