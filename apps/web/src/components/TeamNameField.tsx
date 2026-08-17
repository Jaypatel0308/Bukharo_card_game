import { useEffect, useRef, useState } from 'react';

interface Props {
  label: string;
  /** The authoritative name, as the server has it. */
  value: string;
  disabled?: boolean;
  onCommit(name: string): void;
  /** How long to wait after a keystroke before telling the table. */
  commitDelayMs?: number;
}

/**
 * The team name box.
 *
 * What it is really solving: the field used to be driven straight from the
 * server value, and the server normalises every name it is sent. So each
 * keystroke round-tripped through `trim()` and an empty-means-default rule,
 * which made the field unusable in two ways — deleting the last character
 * snapped the name back to "Team A", and a space was swallowed the moment it
 * was typed, turning "The Sharks" into "TheSharks".
 *
 * Now the box owns what you are typing. The server is told once you pause or
 * move on, and its answer is only adopted when you are not mid-edit.
 */
export function TeamNameField({ label, value, disabled = false, onCommit, commitDelayMs = 600 }: Props) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  const commit = useRef(onCommit);

  useEffect(() => {
    commit.current = onCommit;
  });

  // Adopt the server's value, but never over the top of someone typing.
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);

  // Push edits out while typing so the rest of the table sees the new name,
  // but never an empty one: the server reads that as "reset to the default",
  // which is exactly the snap-back this component exists to prevent.
  useEffect(() => {
    if (!editing.current || draft === value || draft.trim() === '') return;
    const timer = window.setTimeout(() => commit.current(draft), commitDelayMs);
    return () => window.clearTimeout(timer);
  }, [draft, value, commitDelayMs]);

  return (
    <input
      className="teamName__input"
      value={draft}
      maxLength={20}
      aria-label={label}
      disabled={disabled}
      onFocus={() => {
        editing.current = true;
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        editing.current = false;

        // A blank box on the way out is a genuine reset. The server's answer
        // is the default name, but if that is what it already had there will
        // be no broadcast to adopt — so the last good name is restored here
        // rather than leaving the box empty waiting for one.
        if (draft.trim() === '') {
          commit.current('');
          setDraft(value);
          return;
        }
        if (draft !== value) commit.current(draft);
      }}
    />
  );
}
