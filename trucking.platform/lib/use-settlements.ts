"use client";
import { useCallback, useEffect, useState } from 'react';
import { emptySettlements, type SettlementAction, type SettlementState } from './settlements';
import { commitSettlementAction, getSettlementsState } from './settlements-actions';

export function useSettlements() {
  const [state, setState] = useState<SettlementState>(emptySettlements), [ready, setReady] = useState(false), [error, setError] = useState('');
  const [retries, setRetries] = useState(0);
  const refresh = useCallback(async () => { try { const next = await getSettlementsState(); setState(s => next.revision >= s.revision ? next : s); setReady(true); setError(''); setRetries(0); } catch (e) { setError((e as Error).message); setReady(false); } }, []);
  useEffect(() => {
    void refresh();
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ma-king-settlements') : null;
    if (channel) channel.onmessage = () => void refresh();
    const wake = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('pageshow', wake);
    return () => { channel?.close(); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake); window.removeEventListener('pageshow', wake); };
  }, [refresh]);
  // Si la carga falla (señal floja, servidor dormido), reintenta sola unas
  // cuantas veces en vez de dejar la pantalla vacía hasta que se cierre y se
  // abra la app.
  useEffect(() => {
    if (ready || !error || retries >= 5) return;
    const id = setTimeout(() => { setRetries(n => n + 1); void refresh(); }, 2500 * (retries + 1));
    return () => clearTimeout(id);
  }, [ready, error, retries, refresh]);
  const commit = async (action: SettlementAction, revision = state.revision) => {
    if (!ready) throw new Error('Supabase no está disponible.');
    const next = await commitSettlementAction(action, revision);
    setState(next);
    if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('ma-king-settlements'); channel.postMessage('updated'); channel.close(); }
    return next;
  };
  return { state, ready, error, refresh, commit };
}
export type SettlementsController = ReturnType<typeof useSettlements>;
