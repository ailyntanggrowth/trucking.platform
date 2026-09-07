"use client";
import { useCallback, useEffect, useState } from 'react';
import { listMyLoads } from './loads-actions';
import type { Load } from './loads';

// Solo para el rol 'driver' — ver lib/loads-actions.ts:listMyLoads, el
// filtro por driver_id se resuelve del lado del servidor a partir de la
// sesión, nunca de algo que mande este hook.
export function useMyLoads(getAccessToken: () => Promise<string>) {
  const [loads, setLoads] = useState<Load[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const token = await getAccessToken();
      setLoads(await listMyLoads(token));
      setReady(true); setError('');
    } catch (e) { setError((e as Error).message); }
  }, [getAccessToken]);

  useEffect(() => {
    void refresh();
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [refresh]);

  return { loads, ready, error, refresh };
}
export type MyLoadsController = ReturnType<typeof useMyLoads>;
