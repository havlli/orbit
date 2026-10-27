'use client';

import { useId } from 'react';
import { ArrowUpRight } from 'lucide-react';

interface Props {
  chapter: string;
  mission: string;
  year: string;
  title: string;
  description: string;
  discoveryTitle: string;
  discoveryText: string;
  coverage?: string;
  source: string;
}

export default function ReadingChapter(props: Props) {
  const headingId = useId();
  const showDiscovery =
    props.discoveryText.trim().length > 0 &&
    props.discoveryText.trim() !== props.description.trim();
  return (
    <article
      key={props.chapter}
      className="reading-chapter"
      aria-labelledby={headingId}
    >
      <header aria-live="polite" aria-atomic="true">
        <p className="reading-chapter-meta">
          <span>{props.chapter}</span> {props.year} · {props.mission}
        </p>
        <h1 id={headingId}>{props.title}</h1>
      </header>
      <p className="reading-chapter-description">{props.description}</p>
      {showDiscovery && (
        <section className="reading-chapter-discovery">
          <h2>
            {props.discoveryTitle.trim() &&
            props.discoveryTitle.trim() !== props.title.trim()
              ? props.discoveryTitle
              : 'The discovery'}
          </h2>
          <p>{props.discoveryText}</p>
        </section>
      )}
      {props.coverage && (
        <details className="reading-chapter-coverage">
          <summary>Trajectory & coverage</summary>
          <p>{props.coverage}</p>
        </details>
      )}
      <a
        className="reading-chapter-source"
        href={props.source}
        target="_blank"
        rel="noreferrer"
      >
        Read the mission record <ArrowUpRight size={15} aria-hidden="true" />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </article>
  );
}
