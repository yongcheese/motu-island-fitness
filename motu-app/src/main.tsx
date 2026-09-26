import {StrictMode, Component, ErrorInfo, ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installGlobalInputGuards } from './lib/inputManager';

// Installed before the first render so EVERY screen is covered from the very first frame - the
// loading screen and auth screen included, not just the game views. See inputManager.ts: this is
// the one and only place the browser's native right-click menu is suppressed, and the one place
// that watches for the browser tearing a pointer gesture down behind our back.
installGlobalInputGuards();

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error at ErrorBoundary:", error, errorInfo);
    this.setState({ errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '2rem',
          backgroundColor: '#fef2f2',
          color: '#991b1b',
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          fontSize: '14px',
          border: '4px solid #f87171',
          margin: '1rem',
          borderRadius: '8px',
          overflow: 'auto',
          maxHeight: '90vh'
        }}>
          <h2 style={{ margin: '0 0 1rem 0', fontSize: '18px', fontWeight: 'bold' }}>
            🚨 Application Runtime Error Detected
          </h2>
          <p style={{ fontWeight: 'bold' }}>Error Message:</p>
          <pre style={{ margin: '0 0 1.5rem 0', background: '#fee2e2', padding: '1rem', borderRadius: '4px' }}>
            {this.state.error?.toString()}
          </pre>
          {this.state.error && (
            <>
              <p style={{ fontWeight: 'bold' }}>Stack Trace:</p>
              <pre style={{ margin: '0 0 1.5rem 0', background: '#fee2e2', padding: '1rem', borderRadius: '4px', overflowX: 'auto' }}>
                {this.state.error.stack}
              </pre>
            </>
          )}
          {this.state.errorInfo && (
            <>
              <p style={{ fontWeight: 'bold' }}>Component Stack:</p>
              <pre style={{ margin: 0, background: '#fee2e2', padding: '1rem', borderRadius: '4px', overflowX: 'auto' }}>
                {this.state.errorInfo.componentStack}
              </pre>
            </>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

