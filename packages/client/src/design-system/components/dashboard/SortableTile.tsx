import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useNavigate } from 'react-router-dom';
import { ModuleDefinition } from './moduleRegistry';
import styles from './ModuleTile.module.css';

interface SortableTileProps {
  module: ModuleDefinition;
}

export function SortableTile({ module }: SortableTileProps) {
  const navigate = useNavigate();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: module.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: 'grab',
  };

  function handleClick() {
    // Only navigate if not dragging
    if (!isDragging) {
      navigate(module.path);
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={styles.tile}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      data-module-id={module.id}
    >
      <span className={styles.icon}>{module.icon}</span>
      <span className={styles.title}>{module.titleKey}</span>
      <span className={styles.description}>{module.descriptionKey}</span>
    </div>
  );
}
