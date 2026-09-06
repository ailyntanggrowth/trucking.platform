"use client";
import { useCallback, useEffect, useState } from 'react';
import { emptySettlements, type SettlementAction, type SettlementState } from './settlements';
import { commitSettlementAction, getSettlementsState } from './settlements-actions';

export function useSettlements() {
  const [state, setState] = useState<SettlementState>(emptySettlements), [ready, setReady] = useState(false), [error, setError] = useState('');
  const refresh = useCallback(async () => { try { const next = await getSettlementsState(); setState(s => next.revision >= s.revision ? next : s); setReady(true); setError(''); } catch (e) { setError((e as Error).message); setReady(false); } }, []);
  useEffect(() => { void refresh(); const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ma-king-settlements') : null; if (channel) channel.onmessage = () => void refresh(); const focus = () => void refresh(); window.addEventListener('focus', focus); return () => { channel?.close(); window.removeEventListener('focus', focus); }; }, [refresh]);
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
