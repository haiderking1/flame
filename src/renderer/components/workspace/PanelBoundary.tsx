import { Component, Suspense, type ReactNode } from "react";
function PanelLoading() { return <div className="optional-panel-loading" role="status">Loading panel…</div>; }
export class PanelBoundary extends Component<{ children: ReactNode; onClose(): void; onRetry(): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <section className="optional-panel-error" role="alert">This panel could not be loaded. Chat is still available.<button onClick={() => { this.props.onRetry(); this.setState({ failed: false }); }}>Retry</button><button onClick={this.props.onClose}>Close</button></section>;
    return <Suspense fallback={<PanelLoading />}>{this.props.children}</Suspense>;
  }
}
