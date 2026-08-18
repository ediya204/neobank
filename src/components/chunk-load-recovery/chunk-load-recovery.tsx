import { Component, ErrorInfo, ReactNode } from 'react';

const RELOAD_MARKER = 'ssc:chunk-reload-attempt';
const RELOAD_GUARD_MS = 60_000;
const SERVER_PROBE_INTERVAL_MS = 2_000;

type ChunkLoadRecoveryProps = {
  children: ReactNode;
};

type ChunkLoadRecoveryState = {
  checking: boolean;
  chunkFailure: boolean;
  error: Error | null;
};

type ReloadMarker = {
  path: string;
  timestamp: number;
};

function errorText(value: unknown) {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}\n${value.stack || ''}`;
  }
  return String(value || '');
}

export function isChunkLoadError(value: unknown) {
  const text = errorText(value);
  const isWebpackModuleFactoryMismatch =
    /Cannot read properties of undefined \(reading ['"]call['"]\)/i.test(text) &&
    /(?:options\.factory|__webpack_require__)/i.test(text);

  return (
    /ChunkLoadError/i.test(text) ||
    /Loading chunk .+ failed/i.test(text) ||
    /Failed to fetch dynamically imported module/i.test(text) ||
    /Importing a module script failed/i.test(text) ||
    isWebpackModuleFactoryMismatch
  );
}

function asError(value: unknown) {
  return value instanceof Error ? value : new Error(errorText(value) || 'Chunk resource failed');
}

function currentPath() {
  return `${window.location.pathname}${window.location.search}`;
}

function readReloadMarker(): ReloadMarker | null {
  try {
    const value = window.sessionStorage.getItem(RELOAD_MARKER);
    return value ? (JSON.parse(value) as ReloadMarker) : null;
  } catch {
    return null;
  }
}

function markReloadAttempt() {
  try {
    window.sessionStorage.setItem(
      RELOAD_MARKER,
      JSON.stringify({ path: currentPath(), timestamp: Date.now() })
    );
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

function clearReloadMarker() {
  try {
    window.sessionStorage.removeItem(RELOAD_MARKER);
  } catch {
    // A manual retry can still continue when storage is unavailable.
  }
}

function hasRecentReloadAttempt() {
  const marker = readReloadMarker();
  return Boolean(
    marker && marker.path === currentPath() && Date.now() - marker.timestamp < RELOAD_GUARD_MS
  );
}

export default class ChunkLoadRecovery extends Component<
  ChunkLoadRecoveryProps,
  ChunkLoadRecoveryState
> {
  private probeInFlight = false;

  private probeTimer: number | null = null;

  constructor(props: ChunkLoadRecoveryProps) {
    super(props);
    this.state = {
      checking: false,
      chunkFailure: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): ChunkLoadRecoveryState {
    return {
      checking: false,
      chunkFailure: isChunkLoadError(error),
      error,
    };
  }

  componentDidMount() {
    window.addEventListener('error', this.handleWindowError);
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    if (isChunkLoadError(error)) this.beginRecovery();
  }

  componentWillUnmount() {
    window.removeEventListener('error', this.handleWindowError);
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
    this.clearProbeTimer();
    this.probeInFlight = false;
  }

  private clearProbeTimer = () => {
    if (this.probeTimer) {
      window.clearTimeout(this.probeTimer);
      this.probeTimer = null;
    }
  };

  private captureChunkFailure = (value: unknown) => {
    if (!isChunkLoadError(value)) return false;

    this.setState(
      {
        checking: true,
        chunkFailure: true,
        error: asError(value),
      },
      this.beginRecovery
    );
    return true;
  };

  private handleWindowError = (event: ErrorEvent) => {
    const { target } = event;
    const failedScript = target instanceof HTMLScriptElement ? target.src : '';
    const failure = event.error || event.message || failedScript;

    if (this.captureChunkFailure(failure) || /\.chunk\.js(?:\?|$)/i.test(failedScript)) {
      event.preventDefault();
      if (!isChunkLoadError(failure)) {
        this.captureChunkFailure(new Error(`Loading chunk ${failedScript} failed`));
      }
    }
  };

  private handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (this.captureChunkFailure(event.reason)) event.preventDefault();
  };

  private beginRecovery = () => {
    this.clearProbeTimer();
    if (this.probeInFlight) return;

    if (hasRecentReloadAttempt()) {
      this.setState({ checking: false });
      return;
    }

    this.setState({ checking: true }, this.probeServer);
  };

  private probeServer = async () => {
    this.probeInFlight = true;
    try {
      const response = await fetch(window.location.href, {
        method: 'HEAD',
        cache: 'no-store',
        credentials: 'same-origin',
      });

      if (!response.ok) throw new Error(`Page probe returned ${response.status}`);

      markReloadAttempt();
      window.location.reload();
    } catch {
      this.probeInFlight = false;
      this.setState({ checking: false });
      this.probeTimer = window.setTimeout(this.beginRecovery, SERVER_PROBE_INTERVAL_MS);
    }
  };

  private handleManualRetry = () => {
    clearReloadMarker();
    this.beginRecovery();
  };

  render() {
    const { children } = this.props;
    const { checking, chunkFailure, error } = this.state;

    if (!error) return children;
    if (!chunkFailure) throw error;

    return (
      <main
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: '#F4F7F6',
          color: '#172B27',
          fontFamily: 'Public Sans, sans-serif',
        }}
      >
        <section
          role="alert"
          style={{
            width: '100%',
            maxWidth: 440,
            padding: 32,
            border: '1px solid #DCE7E3',
            borderRadius: 16,
            background: '#FFFFFF',
            boxShadow: '0 18px 45px rgba(20, 63, 56, 0.08)',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 40,
              height: 40,
              display: 'grid',
              placeItems: 'center',
              marginBottom: 20,
              borderRadius: 12,
              background: '#E7F5F0',
              color: '#16876A',
              fontSize: 20,
              fontWeight: 800,
            }}
          >
            ↻
          </div>
          <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.3 }}>页面资源正在恢复</h1>
          <p style={{ margin: '12px 0 24px', color: '#5B716B', lineHeight: 1.7 }}>
            系统检测到页面版本已更新，正在重新连接并加载最新资源。你的账户数据不会受到影响。
          </p>
          <button
            type="button"
            disabled={checking}
            onClick={this.handleManualRetry}
            style={{
              minHeight: 44,
              padding: '10px 18px',
              border: 0,
              borderRadius: 10,
              background: checking ? '#AEC7BF' : '#146B5C',
              color: '#FFFFFF',
              cursor: checking ? 'wait' : 'pointer',
              font: 'inherit',
              fontWeight: 700,
            }}
          >
            {checking ? '正在连接…' : '立即重试'}
          </button>
        </section>
      </main>
    );
  }
}
