import { useRef, useState } from 'react';

export function usePendingAction() {
  const current = useRef<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function run(name: string, action: () => Promise<void>, failure: string): Promise<boolean> {
    if (current.current) return false;
    current.current = name;
    setPending(name);
    setError('');
    try {
      await action();
      return true;
    } catch {
      setError(failure);
      return false;
    } finally {
      current.current = null;
      setPending(null);
    }
  }

  return { pending, error, run };
}
