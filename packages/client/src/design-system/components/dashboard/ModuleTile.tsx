import { useNavigate } from 'react-router-dom';
import styles from './ModuleTile.module.css';

interface ModuleTileProps {
  id: string;
  icon: string;
  title: string;
  description: string;
  path: string;
  badge?: string;
  disabled?: boolean;
}

export function ModuleTile({ id, icon, title, description, path, badge, disabled }: ModuleTileProps) {
  const navigate = useNavigate();

  function handleClick() {
    if (!disabled) {
      navigate(path);
    }
  }

  return (
    <div
      className={`${styles.tile} ${disabled ? styles.tileDisabled : ''}`}
      onClick={handleClick}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
      aria-disabled={disabled}
      data-module-id={id}
      data-theme-lock="dark"
    >
      {badge && <span className={styles.badge}>{badge}</span>}
      <span className={styles.icon}>{icon}</span>
      <span className={styles.title}>{title}</span>
      <span className={styles.description}>{description}</span>
    </div>
  );
}
