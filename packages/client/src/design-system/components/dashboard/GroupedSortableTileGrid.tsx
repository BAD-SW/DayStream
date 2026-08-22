import { useState, useEffect } from 'react';
import { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { DashboardGroup } from './DashboardGroup';
import { DASHBOARD_GROUPS } from './dashboardGroups';
import { ModuleDefinition } from './moduleRegistry';
import { apiClient } from '../../../api/client';
import styles from './GroupedSortableTileGrid.module.css';

const STORAGE_KEY = 'dashboard-tile-order';

function loadSavedOrder(): string[] | null {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return null;
  try {
    return JSON.parse(saved);
  } catch {
    return null;
  }
}

function orderModules(modules: ModuleDefinition[], savedOrder: string[] | null): ModuleDefinition[] {
  if (!savedOrder) return modules;
  return [...modules].sort((a, b) => {
    const aIdx = savedOrder.indexOf(a.id);
    const bIdx = savedOrder.indexOf(b.id);
    if (aIdx === -1 && bIdx === -1) return 0;
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });
}

function computeOrderByGroup(modules: ModuleDefinition[]): Record<string, ModuleDefinition[]> {
  const savedOrder = loadSavedOrder();
  const result: Record<string, ModuleDefinition[]> = {};
  for (const group of DASHBOARD_GROUPS) {
    const groupModules = group.moduleIds
      .map((id) => modules.find((m) => m.id === id))
      .filter((m): m is ModuleDefinition => !!m);
    result[group.id] = orderModules(groupModules, savedOrder);
  }
  return result;
}

interface GroupedSortableTileGridProps {
  modules: ModuleDefinition[];
}

/**
 * Business-persona Dashboard tile grid, grouped into named team/role containers
 * (spec: dashboard-tile-grouping-spec.md, Option C). Tile order is still stored as
 * a single flat id array (same 'dashboard-tile-order' key/shape the flat grid used)
 * so no data migration is needed — it's just filtered per group on read and rebuilt
 * as a per-group concatenation on write. Drag-and-drop is scoped within each group.
 */
export function GroupedSortableTileGrid({ modules }: GroupedSortableTileGridProps) {
  const [orderByGroup, setOrderByGroup] = useState<Record<string, ModuleDefinition[]>>(() =>
    computeOrderByGroup(modules),
  );

  useEffect(() => {
    setOrderByGroup(computeOrderByGroup(modules));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modules]);

  function persist(next: Record<string, ModuleDefinition[]>) {
    const orderIds = DASHBOARD_GROUPS.flatMap((group) => (next[group.id] || []).map((m) => m.id));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(orderIds));
    apiClient.put('/v1/profile', { tile_order: JSON.stringify(orderIds) }).catch(() => {});
  }

  function handleGroupDragEnd(groupId: string, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setOrderByGroup((current) => {
      const groupModules = current[groupId] || [];
      const oldIndex = groupModules.findIndex((m) => m.id === active.id);
      const newIndex = groupModules.findIndex((m) => m.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return current;

      const next = { ...current, [groupId]: arrayMove(groupModules, oldIndex, newIndex) };
      persist(next);
      return next;
    });
  }

  function handleReset() {
    localStorage.removeItem(STORAGE_KEY);
    setOrderByGroup(computeOrderByGroup(modules));
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.groupsGrid}>
        {DASHBOARD_GROUPS.map((group) => (
          <DashboardGroup
            key={group.id}
            group={group}
            modules={orderByGroup[group.id] || []}
            onDragEnd={(event) => handleGroupDragEnd(group.id, event)}
          />
        ))}
      </div>
      <button onClick={handleReset} className={styles.resetBtn}>
        Reset tile order
      </button>
    </div>
  );
}
