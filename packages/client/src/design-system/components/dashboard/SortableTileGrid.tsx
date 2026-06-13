import { useState, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableTile } from './SortableTile';
import { ModuleDefinition } from './moduleRegistry';
import { apiClient } from '../../../api/client';

interface SortableTileGridProps {
  modules: ModuleDefinition[];
}

/**
 * Sortable tile grid — supports drag-and-drop reordering.
 * Persists order to user preferences via API.
 */
export function SortableTileGrid({ modules }: SortableTileGridProps) {
  const [orderedModules, setOrderedModules] = useState<ModuleDefinition[]>(modules);

  // Load saved order on mount
  useEffect(() => {
    const savedOrder = localStorage.getItem('dashboard-tile-order');
    if (savedOrder) {
      try {
        const orderIds: string[] = JSON.parse(savedOrder);
        const sorted = [...modules].sort((a, b) => {
          const aIdx = orderIds.indexOf(a.id);
          const bIdx = orderIds.indexOf(b.id);
          if (aIdx === -1 && bIdx === -1) return 0;
          if (aIdx === -1) return 1;
          if (bIdx === -1) return -1;
          return aIdx - bIdx;
        });
        setOrderedModules(sorted);
      } catch {
        setOrderedModules(modules);
      }
    } else {
      setOrderedModules(modules);
    }
  }, [modules]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setOrderedModules((items) => {
      const oldIndex = items.findIndex((i) => i.id === active.id);
      const newIndex = items.findIndex((i) => i.id === over.id);
      const newOrder = arrayMove(items, oldIndex, newIndex);

      // Persist order
      const orderIds = newOrder.map((m) => m.id);
      localStorage.setItem('dashboard-tile-order', JSON.stringify(orderIds));

      // Also try to persist to server (best effort)
      apiClient.put('/v1/profile', { tile_order: JSON.stringify(orderIds) }).catch(() => {});

      return newOrder;
    });
  }

  function handleReset() {
    setOrderedModules(modules);
    localStorage.removeItem('dashboard-tile-order');
  }

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedModules.map((m) => m.id)} strategy={rectSortingStrategy}>
          <div style={styles.grid}>
            {orderedModules.map((mod) => (
              <SortableTile key={mod.id} module={mod} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <button onClick={handleReset} style={styles.resetBtn}>
        Reset tile order
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 'var(--space-md)',
  },
  resetBtn: {
    marginTop: 'var(--space-md)',
    background: 'none',
    border: 'none',
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--font-size-xs)',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
};
