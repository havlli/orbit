'use client';

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { ArrowUpRight, ArrowRight, Orbit } from 'lucide-react';

export type EntryMode = 'story' | 'atlas';
export interface ScenePreparation {
  status: 'loading' | 'ready' | 'fallback';
  progress: number;
}

interface Props {
  preparation: ScenePreparation;
  openingReady: boolean;
  choice: EntryMode | null;
  leaving: boolean;
  onChoose: (mode: EntryMode) => void;
}

export default function ExpeditionWelcome({
  preparation,
  openingReady,
  choice,
  leaving,
  onChoose,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.focus({ preventScroll: true });
  }, []);
  const cycleChoices = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab') return;
    const choices = event.currentTarget.querySelectorAll<HTMLButtonElement>(
      '.welcome-choices button:not(:disabled)',
    );
    const first = choices[0];
    const last = choices[choices.length - 1];
    if (!first) {
      event.preventDefault();
    } else if (
      event.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === event.currentTarget)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  const available = preparation.status === 'fallback' || openingReady;
  const status =
    preparation.status === 'fallback'
      ? 'The expedition is ready in reading mode'
      : leaving
        ? choice === 'atlas'
          ? 'Opening the solar atlas'
          : 'Your journey begins'
        : choice
          ? choice === 'atlas'
            ? 'Preparing the solar atlas'
            : 'Preparing your first encounter'
          : available
            ? 'Ready when you are'
            : 'Preparing the solar system';

  return (
    <dialog
      ref={dialog}
      open
      tabIndex={-1}
      className={`expedition-welcome ${leaving ? 'welcome-leaving' : choice ? 'welcome-preparing' : ''}`}
      aria-modal="true"
      aria-labelledby="welcome-title"
      aria-describedby="welcome-description"
      onKeyDown={cycleChoices}
      inert={leaving}
    >
      <div className="welcome-scenery" aria-hidden="true">
        <div className="welcome-veil" />
        <div className="welcome-hairline" />
      </div>
      <header className="welcome-masthead">
        <span className="welcome-brand">
          <Orbit size={28} strokeWidth={1.1} aria-hidden="true" /> orbit.
        </span>
        <span className="welcome-edition">
          AN EXPEDITION THROUGH SPACE & TIME
        </span>
      </header>
      <div className="welcome-content">
        <p className="welcome-kicker">
          <i /> THE SOLAR SYSTEM, IN MOTION
        </p>
        <h1 id="welcome-title">
          <span>Look up.</span>
          <span>Go farther.</span>
        </h1>
        <p id="welcome-description">
          Follow the missions that took us beyond Earth, or choose a destination
          in the solar atlas.
        </p>
        <div className="welcome-choices" aria-label="Choose your expedition">
          <button
            className="welcome-journey"
            data-selected={choice === 'story' || undefined}
            aria-busy={choice === 'story' && !leaving}
            onClick={() => onChoose('story')}
            disabled={choice !== null}
          >
            <span>
              <strong>Begin the journey</strong>
              <small>
                16 encounters · <span className="welcome-dates">1957–2021</span>
              </small>
            </span>
            <ArrowRight size={21} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <button
            className="welcome-atlas"
            data-selected={choice === 'atlas' || undefined}
            aria-busy={choice === 'atlas' && !leaving}
            onClick={() => onChoose('atlas')}
            disabled={choice !== null}
          >
            <span>
              <strong>Explore the atlas</strong>
              <small>Planets, moons &amp; small worlds</small>
            </span>
            <ArrowUpRight size={20} strokeWidth={1.3} aria-hidden="true" />
          </button>
        </div>
        <div className="welcome-preparation">
          <output
            className="welcome-status"
            aria-live="polite"
            aria-atomic="true"
          >
            <i className={available ? 'prepared' : ''} />
            {status}
          </output>
          {preparation.status === 'loading' && (
            <progress
              className="welcome-progress"
              aria-label="Scene preparation"
              max={100}
              value={preparation.progress}
              aria-valuetext={status}
            />
          )}
        </div>
      </div>
      {preparation.status !== 'fallback' && (
        <aside className="welcome-world" aria-label="Our point of departure">
          <span>01 / OUR POINT OF DEPARTURE</span>
          <strong>Earth</strong>
          <i aria-hidden="true" />
        </aside>
      )}
      <footer className="welcome-footer">
        <p>
          Recorded missions.
          <span>An undated solar atlas.</span>
        </p>
      </footer>
    </dialog>
  );
}
