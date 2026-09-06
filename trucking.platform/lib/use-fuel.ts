"use client";
import { useCallback, useEffect, useState } from 'react';
import { emptyFuel, type FuelAction, type FuelState } from './fuel';
import { commitFuelAction, commitExpenseAction, getFuelState } from './fuel-actions';

export function useFuel() {
  const [state, setState] = useState<FuelState>(emptyFuel), [ready, setReady] = useState(false), [error, setError] = useState('');
  const refresh = useCallback(async () => { try { const next = await getFuelState(); setState(s => next.revision >= s.revision ? next : s); setReady(true); setError(''); } catch (e) { setError((e as Error).message); setReady(false); } }, []);
  useEffect(() => { void refresh(); const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ma-king-fuel') : null; if (channel) channel.onmessage = () => void refresh(); const focus = () => void refresh(); window.addEventListener('focus', focus); return () => { channel?.close(); window.removeEventListener('focus', focus); }; }, [refresh]);
  const commit = async (action: FuelAction, revision = state.revision) => {
    if (!ready) throw new Error('Supabase no está disponible.');
    let next: FuelState;
    if (action.type === 'expense') {
      const fields = new FormData();
      fields.set('id', action.record.id); fields.set('category', action.record.category); fields.set('amount', String(action.record.amount));
      fields.set('date', action.record.date); fields.set('driverId', action.record.driverId); fields.set('truckId', action.record.truckId);
      fields.set('loadRef', action.record.loadRef); fields.set('paymentMethod', action.record.paymentMethod); fields.set('notes', action.record.notes);
      fields.set('status', action.record.status); fields.set('reason', action.reason);
      fields.set('existingReceiptFilename', action.record.receiptFilename || '');
      if (action.receiptFile) fields.set('receipt', action.receiptFile, action.record.receiptFilename || 'receipt');
      next = await commitExpenseAction(fields, revision);
    } else {
      next = await commitFuelAction(action, revision);
    }
    setState(next);
    if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('ma-king-fuel'); channel.postMessage('updated'); channel.close(); }
    return next;
  };
  return { state, ready, error, refresh, commit };
}
export type FuelController = ReturnType<typeof useFuel>;
