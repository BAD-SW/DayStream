import { ComponentType, SVGProps } from 'react';
import { DeskIcon, ChartIcon, TagIcon, BriefcaseIcon } from './DashboardGroupIcons';

export type DashboardGroupId = 'front-desk' | 'back-office' | 'growth' | 'admin';

export interface DashboardGroupConfig {
  id: DashboardGroupId;
  label: string;
  accentColor: string;      // light-mode hex
  accentColorDark: string;  // dark-mode hex
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  moduleIds: string[];      // module ids from moduleRegistry, in default display order
}

/**
 * Business-persona Dashboard tile groups (Option C — by team/role).
 * Group membership is config-driven; re-grouping a module is a data change here,
 * not a layout change in DashboardGroup/GroupedSortableTileGrid.
 */
export const DASHBOARD_GROUPS: DashboardGroupConfig[] = [
  {
    id: 'front-desk',
    label: 'Front Desk',
    accentColor: '#4A7FB5',
    accentColorDark: '#6FA0D8',
    icon: DeskIcon,
    moduleIds: ['appointments', 'schedule', 'customers'],
  },
  {
    id: 'back-office',
    label: 'Back Office',
    accentColor: '#6B8F63',
    accentColorDark: '#8FBF86',
    icon: ChartIcon,
    moduleIds: ['accounting', 'reports'],
  },
  {
    id: 'growth',
    label: 'Growth',
    accentColor: '#C77B3E',
    accentColorDark: '#E0A468',
    icon: TagIcon,
    // 'events' and 'community' only appear once their feature flags are on and
    // getVisibleModules includes them — no code change needed when that happens.
    moduleIds: ['marketing', 'offerings', 'website', 'events', 'community'],
  },
  {
    id: 'admin',
    label: 'Admin',
    accentColor: '#8064B0',
    accentColorDark: '#A98AD1',
    icon: BriefcaseIcon,
    moduleIds: ['business', 'business-settings'],
  },
];
