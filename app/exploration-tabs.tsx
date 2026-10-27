'use client';

import { useRef, type KeyboardEvent } from 'react';

type ExplorationMode = 'story' | 'atlas';

interface Props {
  value: ExplorationMode;
  onValueChange: (value: ExplorationMode) => void;
}

const modes = [
  { value: 'story', label: 'The human journey' },
  { value: 'atlas', label: 'Solar atlas' },
] as const;

export default function ExplorationTabs({ value, onValueChange }: Props) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let next: number;
    switch (event.key) {
      case 'ArrowLeft':
        next = (index + modes.length - 1) % modes.length;
        break;
      case 'ArrowRight':
        next = (index + 1) % modes.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = modes.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    buttons.current[next]?.focus({ preventScroll: true });
    if (modes[next].value !== value) onValueChange(modes[next].value);
  };

  return (
    <div
      className="mode-tabs"
      data-slot="tabs-list"
      role="tablist"
      aria-label="Exploration mode"
      aria-orientation="horizontal"
    >
      {modes.map((mode, index) => (
        <button
          key={mode.value}
          ref={(button) => {
            buttons.current[index] = button;
          }}
          type="button"
          role="tab"
          data-slot="tabs-trigger"
          data-active={mode.value === value ? '' : undefined}
          aria-selected={mode.value === value}
          tabIndex={mode.value === value ? 0 : -1}
          onKeyDown={(event) => onKeyDown(event, index)}
          onClick={() => {
            if (mode.value !== value) onValueChange(mode.value);
          }}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}
