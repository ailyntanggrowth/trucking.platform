"use client";
import { useCallback, useEffect, useState } from 'react';
import { emptyLoads, type LoadAction, type LoadState } from './loads';
import { commitLoadAction, getLoadsState } from './loads-actions';

export function useLoads() {
  const [state, setState] = useState<LoadState>(emptyLoads), [ready, setReady] = useState(false), [error, setError] = useState('');
  const refresh = useCallback(async () => { try { const next = await getLoadsState(); setState(s => next.revision >= s.revision ? next : s); setReady(true); setError(''); } catch (e) { setError((e as Error).message); setReady(false); } }, []);
  useEffect(() => {
    // Pedido explícito: en el celular, al reabrir la app (sin cerrarla del
    // todo) a veces queda "congelada" desde antes de que el teléfono la
    // pusiera en segundo plano — 'focus' no siempre dispara ahí. Se agregan
    // 'visibilitychange'/'pageshow' (sí disparan al volver a primer plano en
    // iOS/Android) para que siempre se refresque sin tener que forzar cierre.
    void refresh();
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ma-king-loads') : null;
    if (channel) channel.onmessage = () => void refresh();
    const wake = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('pageshow', wake);
    return () => { channel?.close(); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake); window.removeEventListener('pageshow', wake); };
  }, [refresh]);
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
