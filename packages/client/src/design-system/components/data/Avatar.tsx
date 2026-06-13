interface AvatarProps {
  src?: string;
  name: string;
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = { sm: 32, md: 40, lg: 64 };

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

export function Avatar({ src, name, size = 'md' }: AvatarProps) {
  const px = sizeMap[size];

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        style={{
          width: px,
          height: px,
          borderRadius: 'var(--radius-full)',
          objectFit: 'cover',
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: px,
        height: px,
        borderRadius: 'var(--radius-full)',
        background: 'var(--color-primary)',
        color: 'var(--color-primary-contrast)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: px * 0.4,
        fontWeight: 'var(--font-weight-semibold)' as any,
      }}
      aria-label={name}
    >
      {getInitials(name)}
    </div>
  );
}
