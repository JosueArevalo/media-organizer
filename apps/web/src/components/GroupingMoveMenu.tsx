import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export type GroupingMoveDestination = {
  key: string;
  label: string;
  preservedScopePath?: string;
};

type GroupingMoveMenuProps = {
  destinations: GroupingMoveDestination[];
  label: string;
  disabled?: boolean;
  onSelect: (destination: GroupingMoveDestination) => void | Promise<void>;
};

export const GroupingMoveMenu = ({ destinations, label, disabled = false, onSelect }: GroupingMoveMenuProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pendingFocusIndexRef = useRef<number | null>(null);
  const typeaheadRef = useRef('');
  const typeaheadTimeoutRef = useRef<number | null>(null);
  const menuId = useId();
  const isDisabled = disabled || destinations.length === 0;

  const closeMenu = (restoreFocus: boolean) => {
    setIsOpen(false);
    pendingFocusIndexRef.current = null;
    typeaheadRef.current = '';
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const openMenu = (focusIndex: number) => {
    if (isDisabled) return;
    pendingFocusIndexRef.current = focusIndex;
    setIsOpen(true);
  };

  useEffect(() => {
    if (!isOpen || pendingFocusIndexRef.current === null) return;
    optionRefs.current[pendingFocusIndexRef.current]?.focus();
    pendingFocusIndexRef.current = null;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) closeMenu(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen]);

  useEffect(() => {
    if (isDisabled && isOpen) closeMenu(false);
  }, [isDisabled, isOpen]);

  useEffect(() => () => {
    if (typeaheadTimeoutRef.current !== null) window.clearTimeout(typeaheadTimeoutRef.current);
  }, []);

  const focusOption = (index: number) => {
    const normalizedIndex = (index + destinations.length) % destinations.length;
    optionRefs.current[normalizedIndex]?.focus();
  };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption(index + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusOption(index - 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      focusOption(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      focusOption(destinations.length - 1);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === 'Tab') {
      closeMenu(false);
      return;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;

    typeaheadRef.current += event.key.toLocaleLowerCase();
    if (typeaheadTimeoutRef.current !== null) window.clearTimeout(typeaheadTimeoutRef.current);
    typeaheadTimeoutRef.current = window.setTimeout(() => {
      typeaheadRef.current = '';
      typeaheadTimeoutRef.current = null;
    }, 500);

    const matchOffset = destinations
      .slice(index + 1)
      .concat(destinations.slice(0, index + 1))
      .findIndex((destination) => destination.label.toLocaleLowerCase().startsWith(typeaheadRef.current));
    if (matchOffset >= 0) focusOption((index + 1 + matchOffset) % destinations.length);
  };

  return (
    <div className="grouping-move-menu" ref={containerRef}>
      <button
        ref={triggerRef}
        className="grouping-move-menu-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={menuId}
        disabled={isDisabled}
        onClick={() => {
          if (isOpen) closeMenu(false);
          else openMenu(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openMenu(0);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu(destinations.length - 1);
          } else if (event.key === 'Escape' && isOpen) {
            event.preventDefault();
            closeMenu(true);
          }
        }}
      >
        <span>{label}</span>
        <span className="grouping-move-menu-chevron" aria-hidden="true" />
      </button>
      {isOpen && (
        <div className="grouping-move-menu-options" id={menuId} role="menu" aria-label={label}>
          {destinations.map((destination, index) => (
            <button
              key={destination.key}
              ref={(element) => { optionRefs.current[index] = element; }}
              className="grouping-move-menu-option"
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu(false);
                void onSelect(destination);
              }}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
            >
              {destination.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
