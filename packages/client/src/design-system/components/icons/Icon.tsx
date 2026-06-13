import { icons, LucideProps } from 'lucide-react';

interface IconProps extends Omit<LucideProps, 'size'> {
  name: keyof typeof icons;
  size?: 'sm' | 'md' | 'lg';
  'aria-label'?: string;
}

const sizeMap = { sm: 16, md: 20, lg: 24 };

export function Icon({ name, size = 'md', 'aria-label': ariaLabel, ...props }: IconProps) {
  const LucideIcon = icons[name];

  if (!LucideIcon) {
    console.warn(`Icon "${name}" not found in Lucide`);
    return null;
  }

  return (
    <LucideIcon
      size={sizeMap[size]}
      aria-hidden={!ariaLabel}
      aria-label={ariaLabel}
      role={ariaLabel ? 'img' : undefined}
      {...props}
    />
  );
}
