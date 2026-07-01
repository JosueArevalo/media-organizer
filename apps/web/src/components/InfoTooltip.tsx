import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

type InfoTooltipProps = {
  label: string;
  children: ReactNode;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  placement?: 'bottom-center' | 'top-start';
  icon?: 'circled' | 'plain';
};

export const InfoTooltip = ({
  label,
  children,
  className,
  triggerClassName,
  contentClassName,
  placement = 'bottom-center',
  icon = 'circled'
}: InfoTooltipProps) => {
  const tooltipId = useId();
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const containerClassName = ['info-tooltip', className].filter(Boolean).join(' ');
  const triggerClasses = ['info-tooltip-trigger', triggerClassName].filter(Boolean).join(' ');
  const contentClasses = ['info-tooltip-content', `info-tooltip-content-${placement}`, contentClassName].filter(Boolean).join(' ');

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        setIsPinned(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        setIsPinned(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <span
      className={containerClassName}
      ref={containerRef}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => {
        if (!isPinned) setIsOpen(false);
      }}
      onFocus={() => setIsOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsOpen(false);
          setIsPinned(false);
        }
      }}
    >
      <button
        className={triggerClasses}
        type="button"
        aria-label={label}
        aria-expanded={isOpen}
        aria-describedby={isOpen ? tooltipId : undefined}
        onClick={() => {
          if (isOpen && isPinned) {
            setIsOpen(false);
            setIsPinned(false);
            return;
          }

          setIsOpen(true);
          setIsPinned(true);
        }}
      >
        {icon === 'plain' ? (
          <span className="info-tooltip-glyph" aria-hidden="true">i</span>
        ) : (
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="8" />
            <path d="M10 9v5M10 6.2v.1" />
          </svg>
        )}
      </button>
      {isOpen && (
        <span className={contentClasses} id={tooltipId} role="tooltip">
          {children}
        </span>
      )}
    </span>
  );
};
