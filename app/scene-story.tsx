'use client';

import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { storyCue, type StoryBinding } from './scene-story-motion';
import type { DiscoveryBeat } from './mission-cinematography';

interface Props {
  onBinding: (binding: StoryBinding | null) => void;
  chapter: string;
  mission: string;
  title: string;
  description: string;
  subject: string;
  date: string;
  coverage?: string;
  progress: number;
  beat?: DiscoveryBeat;
  reading: boolean;
  hidden: boolean;
  presence?: number;
}

export default function SceneStory({ onBinding, ...props }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLElement>(null);
  const path = useRef<SVGPathElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const liveBinding = useRef<StoryBinding | null>(null);
  useLayoutEffect(() => {
    if (!root.current || !card.current || !path.current || !dot.current) return;
    const cardElement = card.current;
    const binding: StoryBinding = {
      root: root.current,
      path: path.current,
      dot: dot.current,
      width: card.current.offsetWidth,
      height: card.current.offsetHeight,
    };
    liveBinding.current = binding;
    onBinding(binding);
    const observer = new ResizeObserver(() => {
      binding.width = cardElement.offsetWidth;
      binding.height = cardElement.offsetHeight;
    });
    observer.observe(card.current);
    return () => {
      observer.disconnect();
      liveBinding.current = null;
      onBinding(null);
    };
  }, [onBinding]);
  const cue = storyCue(props.progress, props.beat, props.reading);
  const presence = props.hidden ? 0 : cue.presence * (props.presence ?? 1);
  useLayoutEffect(() => {
    if (liveBinding.current) liveBinding.current.presence = presence;
  }, [presence]);
  const style = {
    '--story-presence': presence,
    '--story-heading': cue.heading,
    '--story-detail': cue.detail,
    // Fade complete sentences first; only reclaim their space once invisible.
    '--story-rows': cue.detail > 0 ? '1fr' : '0fr',
  } as CSSProperties;
  const stage =
    props.beat?.stage ?? (cue.detail < 0.2 ? 'following' : 'departure');
  return (
    <div
      ref={root}
      className="scene-story ui-chrome"
      style={style}
      data-stage={stage}
      data-discovery={!!props.beat}
      aria-hidden={props.hidden}
    >
      <svg className="story-leader" aria-hidden="true">
        <path ref={path} />
        <circle ref={dot} r="2" />
      </svg>
      <article ref={card} className="story-card">
        <p className="story-chapter">
          <span>{props.chapter}</span> {props.mission}
        </p>
        <div
          className="story-copy"
          key={props.title}
          aria-live="polite"
          aria-atomic="true"
        >
          <p className="story-subject">
            <span className="story-signal" aria-hidden="true" />
            {props.beat
              ? props.beat.kind === 'tableau'
                ? 'A moment in history'
                : props.beat.stage === 'return'
                  ? 'Returning to the spacecraft'
                  : `Encounter · ${props.subject}`
              : `In flight · ${props.subject}`}
          </p>
          <h1>{props.title}</h1>
          <div className="story-description">
            <p>{props.description}</p>
          </div>
        </div>
        <div className="story-footnote">
          {props.beat && <time>{props.date}</time>}
          {props.coverage && <p>{props.coverage}</p>}
        </div>
      </article>
    </div>
  );
}
