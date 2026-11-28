import { Component, Suspense, type ReactNode } from 'react';
import { Control } from './Control';

export class WorkspaceSection extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="ds-note flex flex-wrap items-center gap-2">
          <p role="alert">Bagian ruang kerja belum dapat dimuat.</p>
          <Control onClick={() => window.location.reload()}>Muat ulang aplikasi</Control>
        </div>
      );
    }
    return <Suspense fallback={<p role="status" className="text-sm text-[var(--text-secondary)]">Memuat bagian ruang kerja…</p>}>{this.props.children}</Suspense>;
  }
}
