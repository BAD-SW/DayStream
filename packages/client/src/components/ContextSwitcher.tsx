import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActiveContext, ContextLevel, SwitchableContext } from '@daystream/shared';
import { useContextManager, Persona } from '../context/ContextManager';
import './ContextSwitcher.css';

interface FlatOption {
  domId: string;
  target: SwitchableContext;
  isActive: boolean;
}

const PLATFORM_OPTION: SwitchableContext = { id: 'system', type: 'system', displayName: 'DayStream Platform' };

function isActiveOption(activeContext: ActiveContext, type: ContextLevel, id: string): boolean {
  if (type === 'system') return activeContext.contextLevel === 'system';
  if (type === 'tenant') return activeContext.contextLevel === 'tenant' && activeContext.tenantId === id;
  return activeContext.contextLevel === 'business' && activeContext.businessId === id;
}

function buildGroups(persona: Persona, activeContext: ActiveContext, accessibleContexts: SwitchableContext[]) {
  const tenants = accessibleContexts.filter((c) => c.type === 'tenant');
  const businesses = accessibleContexts.filter((c) => c.type === 'business');

  const groups: { label: string; domLabelId: string; options: FlatOption[] }[] = [];

  if (persona === 'system') {
    groups.push({
      label: 'Platform',
      domLabelId: 'ctx-group-system',
      options: [{ domId: 'ctx-opt-system', target: PLATFORM_OPTION, isActive: isActiveOption(activeContext, 'system', 'system') }],
    });
  }

  if (tenants.length > 0) {
    groups.push({
      label: 'Tenants',
      domLabelId: 'ctx-group-tenants',
      options: tenants.map((t) => ({
        domId: `ctx-opt-tenant-${t.id}`,
        target: t,
        isActive: isActiveOption(activeContext, 'tenant', t.id),
      })),
    });
  }

  if (businesses.length > 0) {
    groups.push({
      label: 'Businesses',
      domLabelId: 'ctx-group-businesses',
      options: businesses.map((b) => ({
        domId: `ctx-opt-business-${b.id}`,
        target: b,
        isActive: isActiveOption(activeContext, 'business', b.id),
      })),
    });
  }

  return groups;
}

export function ContextSwitcher() {
  const { persona, activeContext, accessibleContexts, isSwitching, switchContext } = useContextManager();
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const isInteractive = persona === 'system' || persona === 'tenant';

  const groups = useMemo(
    () => buildGroups(persona, activeContext, accessibleContexts),
    [persona, activeContext, accessibleContexts],
  );
  const flatOptions = useMemo(() => groups.flatMap((g) => g.options), [groups]);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      const activeIdx = flatOptions.findIndex((o) => o.isActive);
      setFocusedIndex(activeIdx >= 0 ? activeIdx : 0);
    }
  }, [isOpen, flatOptions]);

  if (!isInteractive) {
    return (
      <span className="context-switcher context-switcher--static">
        {activeContext.displayName}
      </span>
    );
  }

  async function selectOption(option: FlatOption) {
    setIsOpen(false);
    triggerRef.current?.focus();
    try {
      await switchContext(option.target);
    } catch {
      // switchContext already reverts state; nothing further to do here
    }
  }

  function handleTriggerKeyDown(e: React.KeyboardEvent) {
    if (isSwitching) return;
    if (!isOpen && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setIsOpen(true);
      return;
    }
    if (!isOpen) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex((i) => (flatOptions.length === 0 ? 0 : (i + 1) % flatOptions.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex((i) => (flatOptions.length === 0 ? 0 : (i - 1 + flatOptions.length) % flatOptions.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const option = flatOptions[focusedIndex];
      if (option) selectOption(option);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    }
  }

  const activeDescendant = isOpen && flatOptions[focusedIndex] ? flatOptions[focusedIndex].domId : undefined;

  return (
    <div
      ref={rootRef}
      className="context-switcher"
      role="combobox"
      aria-expanded={isOpen}
      aria-haspopup="listbox"
      aria-label="Active context"
      aria-activedescendant={activeDescendant}
    >
      <button
        ref={triggerRef}
        type="button"
        className="context-switcher__trigger"
        aria-expanded={isOpen}
        aria-busy={isSwitching}
        disabled={isSwitching}
        onClick={() => setIsOpen((o) => !o)}
        onKeyDown={handleTriggerKeyDown}
      >
        {activeContext.logoUrl && (
          <img
            className="context-switcher__logo"
            src={activeContext.logoUrl}
            alt={`${activeContext.displayName} logo`}
            width={24}
            height={24}
          />
        )}
        <span className="context-switcher__label">{activeContext.displayName}</span>
        {isSwitching ? (
          <span className="context-switcher__spinner" aria-label="Switching context" />
        ) : (
          <svg className="context-switcher__chevron" aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
            <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {isOpen && (
        <div className="context-switcher__panel" role="listbox" aria-label="Switch context">
          {groups.map((group) => (
            <div key={group.domLabelId} className="context-switcher__group" role="group" aria-labelledby={group.domLabelId}>
              <span id={group.domLabelId} className="context-switcher__group-label">{group.label}</span>
              {group.options.map((option) => {
                const flatIdx = flatOptions.indexOf(option);
                const isFocused = isOpen && flatIdx === focusedIndex;
                return (
                  <div
                    key={option.domId}
                    id={option.domId}
                    role="option"
                    aria-selected={option.isActive}
                    className={[
                      'context-switcher__option',
                      option.isActive ? 'context-switcher__option--active' : '',
                      isFocused ? 'context-switcher__option--focused' : '',
                    ].filter(Boolean).join(' ')}
                    onMouseEnter={() => setFocusedIndex(flatIdx)}
                    onClick={() => selectOption(option)}
                  >
                    {option.target.logoUrl && (
                      <img
                        className="context-switcher__option-logo"
                        src={option.target.logoUrl}
                        alt=""
                        width={24}
                        height={24}
                      />
                    )}
                    {option.target.displayName}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
