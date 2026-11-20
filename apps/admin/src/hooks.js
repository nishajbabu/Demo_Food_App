import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

// Load data, reload every pollMs (live dashboard), and expose reload().
export function useData(path, pollMs = 0) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api(path));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [path]);

  useEffect(() => {
    reload();
    if (!pollMs) return undefined;
    const t = setInterval(reload, pollMs);
    return () => clearInterval(t);
  }, [reload, pollMs]);

  return { data, error, reload, setData };
}

// Run an action (button click) and show any error in an alert.
export function useAction(after) {
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    setBusy(true);
    try {
      const r = await fn();
      await after?.();
      return r;
    } catch (e) {
      alert(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return [run, busy];
}
