"use client";
import { useCallback, useEffect, useState } from 'react';
import { emptyLoads, type LoadAction, type LoadState } from './loads';
import { commitLoadAction, getLoadsState } from './loads-actions';

export function useLoads() {
  const [state, setState] = useState<LoadState>(emptyLoads), [ready, setReady] = useState(false), [error, setError] = useState('');
  const refresh = useCallback(async () => { try { const next = await getLoadsState(); setState(s => next.revision >= s.revision ? next : s); setReady(true); setError(''); } catch (e) { setError((e as Error).message); setReady(false); } }, []);
  useEffect(() => { void refresh(); const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ma-king-loads') : null; if (channel) channel.onmessage = () => void refresh(); const focus = () => void refresh(); window.addEventListener('focus', focus); return () => { channel?.close(); window.removeEventListener('focus', focus); }; }, [refresh]);
  const commit = async (action: LoadAction, revision = state.revision) => {
    if (!ready) throw new Error('Supabase no está disponible.');
    const next = await commitLoadAction(action, revision);
    setState(next);
    if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('ma-king-loads'); channel.postMessage('updated'); channel.close(); }
    return next;
  };
  return { state, ready, error, refresh, commit };
}
export type LoadsController = ReturnType<typeof useLoads>;
