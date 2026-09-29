import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches a render that throws, so a bug shows as a message rather than a
 * blank page.
 *
 * Without this, one bad render unmounts the whole tree: the player sees white,
 * has no way back, and — because their seat is still held — cannot even tell
 * whether the game is still going. Reloading recovers, since the session token
 * survives in local storage, so the useful thing is to say so.
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The stack is worth more than the message when somebody reports this.
    console.error('[bukharo] render failed', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="screen screen--home">
        <div className="panel">
          <h1 className="home__title">Something broke on this screen</h1>
          <p className="home__tagline">
            Your seat is still held. Reloading should put you back at the table where you left off.
          </p>
          <button
            type="button"
            className="button button--primary button--block"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
          <details className="rules">
            <summary>What went wrong</summary>
            <p className="hint">{error.message}</p>
          </details>
        </div>
      </main>
    );
  }
}
