import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { API_SESSION_REQUIRED } from '../../lib/api-client';

type Session = { state: 'local' | 'sign_in' } | { state: 'authenticated'; expiresInMs: number };
type View = Session | { state: 'loading' | 'unavailable' | 'error' };

function requestSession(method: 'GET' | 'POST' | 'DELETE', token?: string): Promise<Response> {
  return fetch('/api/auth/session', {
    method,
    credentials: 'same-origin',
    redirect: 'error',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

function RemoteAccess({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>({ state: 'loading' });
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let mounted = true;
    requestSession('GET').then(async (response) => {
      const session: View = response.ok ? await response.json() : { state: 'unavailable' };
      if (mounted) setView(session);
    }).catch(() => {
      if (mounted) setView({ state: 'error' });
    });
    function returnToSignIn() {
      setMessage('Sesi Anda telah berakhir. Masuk kembali untuk melanjutkan.');
      setView({ state: 'sign_in' });
    }
    window.addEventListener(API_SESSION_REQUIRED, returnToSignIn);
    return () => {
      mounted = false;
      window.removeEventListener(API_SESSION_REQUIRED, returnToSignIn);
    };
  }, []);

  useEffect(() => {
    if (view.state !== 'authenticated') return;
    const timer = window.setTimeout(() => {
      setMessage('Sesi Anda telah berakhir. Masuk kembali untuk melanjutkan.');
      setView({ state: 'sign_in' });
    }, view.expiresInMs);
    return () => window.clearTimeout(timer);
  }, [view]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const token = String(new FormData(form).get('apiToken') ?? '').trim();
    form.reset();
    setWorking(true);
    setMessage('');
    try {
      const response = await requestSession('POST', token);
      if (response.status === 401) {
        setMessage('Token API tidak valid. Periksa token di host Llamrei.');
      } else if (response.ok) {
        setView(await response.json() as Session);
      } else {
        setMessage('Sesi belum dapat dimulai. Coba lagi.');
      }
    } catch {
      setMessage('Koneksi terputus. Coba lagi.');
    } finally {
      setWorking(false);
    }
  }

  async function signOut() {
    setWorking(true);
    setMessage('');
    try {
      const response = await requestSession('DELETE');
      if (!response.ok) throw new Error('Session could not be revoked');
      setView({ state: 'sign_in' });
    } catch {
      setMessage('Sesi belum dapat diakhiri. Coba lagi.');
    } finally {
      setWorking(false);
    }
  }

  if (view.state === 'local') return children;
  if (view.state === 'authenticated') {
    return (
      <>
        <div className="flex items-center justify-end gap-3 border-b border-[var(--border-subtle)] px-4 text-sm">
          {message && <span role="alert">{message}</span>}
          <button type="button" className="min-h-11 px-2 underline" disabled={working} onClick={() => void signOut()}>
            Keluar dari sesi jarak jauh
          </button>
        </div>
        {children}
      </>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-8">
      <section className="w-full max-w-sm space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-6" aria-labelledby="remote-title">
        <h1 id="remote-title" className="text-xl font-semibold">Masuk ke Llamrei</h1>
        {view.state === 'loading' && <p role="status">Memeriksa sesi…</p>}
        {view.state === 'error' && <p role="alert">Llamrei belum dapat dihubungi. Coba muat ulang halaman.</p>}
        {view.state === 'unavailable' && <p role="alert">Buka alamat HTTPS privat yang dikonfigurasi di host Llamrei.</p>}
        {view.state === 'sign_in' && (
          <form className="space-y-4" onSubmit={(event) => void signIn(event)}>
            <label className="block space-y-2">
              <span className="block text-sm font-medium">Token API dari host Llamrei</span>
              <input name="apiToken" type="password" autoComplete="off" required disabled={working}
                className="min-h-11 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 focus-visible:outline-2 focus-visible:outline-[var(--accent)]" />
            </label>
            {message && <p className="text-sm" role="alert">{message}</p>}
            <button type="submit" disabled={working} className="min-h-11 w-full rounded-md bg-[var(--accent)] px-4 font-semibold text-[var(--accent-fg)] disabled:opacity-60">
              {working ? 'Memverifikasi…' : 'Masuk'}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

export function RemoteAccessGate({ children }: { children: ReactNode }) {
  const { hostname, protocol } = window.location;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  if (isLocal) return children;
  if (protocol === 'https:') return <RemoteAccess>{children}</RemoteAccess>;
  return <main className="grid min-h-screen place-items-center px-4" role="alert">Gunakan alamat HTTPS privat untuk masuk ke Llamrei.</main>;
}
