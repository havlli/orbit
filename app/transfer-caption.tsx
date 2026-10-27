'use client';

import {
  useCallback,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { ReadingArea } from './path-presentation';

interface Props {
  onReading: (area: ReadingArea | null) => void;
  presence: number;
  drift: number;
  arrival: number;
  hidden: boolean;
  children: ReactNode;
}

/** Share measured copy bounds with the orbital-line renderer. Layout is read
 * only when the caption or viewport changes size, never in the animation loop. */
export default function TransferCaption({ onReading, ...props }: Props) {
  const root = useRef<HTMLElement>(null);
  const metrics = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const cue = useRef({ presence: 0, drift: 0 });
  const publish = useCallback(() => {
    onReading({
      ...metrics.current,
      x: metrics.current.x + cue.current.drift,
      presence: cue.current.presence,
    });
  }, [onReading]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      metrics.current = {
        x: element.offsetLeft,
        y: element.offsetTop,
        width: element.offsetWidth,
        height: element.offsetHeight,
      };
      publish();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    return () => {
      observer.disconnect();
      onReading(null);
    };
  }, [onReading, publish]);
  useLayoutEffect(() => {
    cue.current = {
      presence: props.hidden ? 0 : props.presence,
      drift: props.drift,
    };
    publish();
  }, [props.presence, props.drift, props.hidden, publish]);
  return (
    <aside
      ref={root}
      className="transfer-caption ui-chrome"
      aria-label="Camera transfer"
      aria-hidden={props.hidden}
      style={
        {
          '--handoff-presence': props.presence,
          '--handoff-drift': `${props.drift}px`,
          '--handoff-arrival': props.arrival,
        } as CSSProperties
      }
    >
      {props.children}
    </aside>
  );
}
