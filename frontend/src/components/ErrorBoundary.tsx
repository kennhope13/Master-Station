import React from 'react';

interface State { error: Error | null; }

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Render crash:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: '#0a0a0a', color: '#e0e0e0', fontFamily: 'var(--admin-font-mono)', padding: 32, zIndex: 99999
        }}>
          <div style={{ color: '#ef4444', fontSize: '1.2rem', fontWeight: 700, marginBottom: 12 }}>
            ⚠ Lỗi giao diện
          </div>
          <div style={{ color: '#888', fontSize: '0.8rem', marginBottom: 20, maxWidth: 600, textAlign: 'center' }}>
            {this.state.error.message}
          </div>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            style={{ background: '#1976d2', color: '#fff', border: 'none', padding: '8px 20px', cursor: 'pointer', borderRadius: 4 }}
          >
            Tải lại trang
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
