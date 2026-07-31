import type { ActiveContext } from '@daystream/shared';
import type { Persona } from '../context/ContextManager';

const PLATFORM_SEGMENT = 'DayStream';
const TRUNCATE_LENGTH = 24;

/**
 * Formats the ancestry path for the active context.
 *
 * - business/customer persona: just the business name, no ancestor segments
 *   (they cannot navigate system/tenant scope, so those segments would be misleading).
 * - system persona at system level: just the platform name.
 * - system/tenant persona at tenant level: platform + tenant name.
 * - system/tenant persona at business level: platform + tenant name + business name.
 */
export function formatBreadcrumb(context: ActiveContext, persona: Persona): string[] {
  if (persona === 'business' || persona === 'customer') {
    return [context.displayName];
  }
  if (context.contextLevel === 'system') {
    return [PLATFORM_SEGMENT];
  }
  if (context.contextLevel === 'tenant') {
    return [PLATFORM_SEGMENT, context.displayName];
  }
  return [PLATFORM_SEGMENT, context.tenantDisplayName || context.displayName, context.displayName];
}

export function truncateSegment(segment: string): { label: string; truncated: boolean } {
  if (segment.length <= TRUNCATE_LENGTH) return { label: segment, truncated: false };
  return { label: `${segment.slice(0, TRUNCATE_LENGTH)}…`, truncated: true };
}
