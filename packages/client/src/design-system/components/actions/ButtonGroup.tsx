import { ReactNode } from 'react';

interface ButtonGroupProps {
  children: ReactNode;
}

export function ButtonGroup({ children }: ButtonGroupProps) {
  return (
    <div role="group" style={styles.group}>
      {children}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  group: {
    display: 'inline-flex',
    gap: 0,
  },
};
