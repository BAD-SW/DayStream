export type ContextLevel = 'system' | 'tenant' | 'business';

export interface ActiveContext {
  contextLevel: ContextLevel;
  tenantId: string | null;
  businessId: string | null;
  displayName: string;
  logoUrl?: string;
  /** The parent tenant's display name — populated whenever tenantId is set, used by the breadcrumb's middle segment. */
  tenantDisplayName?: string;
}

export interface SwitchableContext {
  id: string;
  type: ContextLevel;
  displayName: string;
  logoUrl?: string;
  parentId?: string;
}

export interface ContextSwitchAuditEntry {
  timestamp: string;
  userId: string;
  previousContext: ActiveContext;
  newContext: ActiveContext;
}

export interface ContextState {
  activeContext: ActiveContext;
  accessibleContexts: SwitchableContext[];
  accessibleContextsError: boolean;
  isSwitching: boolean;
  isInitialising: boolean;
  switchContext: (target: SwitchableContext) => Promise<void>;
  resetToPersonaDefault: () => void;
}
