import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, rectSortingStrategy } from '@dnd-kit/sortable';
import { SortableTile } from './SortableTile';
import { ModuleDefinition } from './moduleRegistry';
import { DashboardGroupConfig } from './dashboardGroups';
import styles from './DashboardGroup.module.css';

interface DashboardGroupProps {
  group: DashboardGroupConfig;
  modules: ModuleDefinition[];
  onDragEnd: (event: DragEndEvent) => void;
}

/**
 * One dashboard tile group: colored left-accent bar, icon badge + label header,
 * and its own drag-and-drop context so reordering stays scoped within the group.
 */
export function DashboardGroup({ group, modules, onDragEnd }: DashboardGroupProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (modules.length === 0) return null;

  const Icon = group.icon;
  const headingId = `dashboard-group-${group.id}-heading`;

  return (
    <section
      className={styles.group}
      role="region"
      aria-labelledby={headingId}
      style={{
        '--group-accent': group.accentColor,
        '--group-accent-dark': group.accentColorDark,
      } as React.CSSProperties}
    >
      <div className={styles.header}>
        <span className={styles.badge} aria-hidden="true">
          <Icon />
        </span>
        <h3 id={headingId} className={styles.label}>{group.label}</h3>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={modules.map((m) => m.id)} strategy={rectSortingStrategy}>
          <div className={styles.tileGrid}>
            {modules.map((mod) => (
              <SortableTile key={mod.id} module={mod} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  );
}
