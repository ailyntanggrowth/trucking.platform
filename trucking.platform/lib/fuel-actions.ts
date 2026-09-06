'use server';
import { randomUUID } from 'node:crypto';
import { applyFuelAction, type Expense, type ExpenseCategory, type FuelAction, type FuelState, type TxStatus } from './fuel';
import { supabaseServer, DEFAULT_COMPANY_ID } from './supabase-server';

const CONFLICT_MESSAGE = 'Los datos cambiaron en otro dispositivo o pestaña. Actualiza y vuelve a intentarlo.';

function asConflictError(error: { message?: string } | null) {
  if (error?.message === 'REVISION_CONFLICT') return new Error(CONFLICT_MESSAGE);
  return error ? new Error(error.message) : null;
}

export async function getFuelState(companyId = DEFAULT_COMPANY_ID): Promise<FuelState> {
  const supabase = supabaseServer();
  const [meta, transactions, expenses, events] = await Promise.all([
    supabase.from('fuel_meta').select('revision').eq('company_id', companyId).single(),
    supabase.from('fuel_transactions').select('*').eq('company_id', companyId),
    supabase.from('expenses').select('*').eq('company_id', companyId),
    supabase.from('fuel_events').select('*').eq('company_id', companyId).order('seq', { ascending: false }),
  ]);
  for (const result of [meta, transactions, expenses, events]) {
    if (result.error) throw new Error(result.error.message);
  }
  return {
    schema: 1,
    revision: meta.data!.revision,
    transactions: (transactions.data ?? []).map(r => ({
      id: r.id, date: r.date, driverId: r.driver_id ?? '', truckId: r.truck_id ?? '', loadRef: r.load_ref,
      station: r.station, city: r.city, state: r.state, gallons: Number(r.gallons), pricePerGallon: Number(r.price_per_gallon),
      fuelAmount: Number(r.fuel_amount), nonFuelAmount: Number(r.non_fuel_amount), status: r.status as TxStatus,
      externalRef: r.external_ref, notes: r.notes,
    })),
    expenses: (expenses.data ?? []).map(r => ({
      id: r.id, category: r.category as ExpenseCategory, amount: Number(r.amount), date: r.date,
      driverId: r.driver_id ?? '', truckId: r.truck_id ?? '', loadRef: r.load_ref, paymentMethod: r.payment_method,
      notes: r.notes, status: r.status as TxStatus, receiptFilename: r.receipt_filename ?? undefined,
      receiptSizeBytes: r.receipt_size_bytes ? Number(r.receipt_size_bytes) : undefined,
      receiptUploadedAt: r.receipt_uploaded_at ?? undefined,
    })),
    events: (events.data ?? []).map(r => ({
      id: r.id, at: r.at, actor: r.actor, entityIds: r.entity_ids, detail: r.detail, before: r.before, after: r.after,
    })),
  };
}

function eventPayload(next: FuelState) {
  const e = next.events[0];
  return { id: e.id, at: e.at, actor: e.actor, entity_ids: e.entityIds, detail: e.detail, before: e.before, after: e.after };
}

// Acciones sin archivo: transaction, setStatus, delete. El caso 'expense' (con
// recibo opcional) va por commitExpenseAction, ver abajo.
export async function commitFuelAction(action: Exclude<FuelAction, { type: 'expense' }>, expectedRevision: number, companyId = DEFAULT_COMPANY_ID): Promise<FuelState> {
  const supabase = supabaseServer();
  const state = await getFuelState(companyId);
  const now = new Date().toISOString();
  const id = randomUUID();
  const next = applyFuelAction(state, action, now, id);
  const event = eventPayload(next);
  let rpc;
  let storagePathToRemove: string | null = null;

  if (action.type === 'transaction') {
    const t = next.transactions.find(x => x.id === action.record.id)!;
    rpc = supabase.rpc('fuel_commit_transaction', {
      p_company_id: companyId, p_expected_revision: expectedRevision,
      p_transaction: {
        id: t.id, date: t.date, driver_id: t.driverId || null, truck_id: t.truckId || null, load_ref: t.loadRef,
        station: t.station, city: t.city, state: t.state, gallons: t.gallons, price_per_gallon: t.pricePerGallon,
        fuel_amount: t.fuelAmount, non_fuel_amount: t.nonFuelAmount, status: t.status, external_ref: t.externalRef, notes: t.notes,
      },
      p_event: event,
    });
  } else if (action.type === 'setStatus') {
    rpc = supabase.rpc('fuel_commit_status', {
      p_company_id: companyId, p_expected_revision: expectedRevision,
      p_kind: action.kind, p_id: action.id, p_status: action.status, p_event: event,
    });
  } else {
    if (action.kind === 'expense') {
      const { data: row } = await supabase.from('expenses').select('receipt_storage_path').eq('id', action.id).eq('company_id', companyId).single();
      storagePathToRemove = row?.receipt_storage_path ?? null;
    }
    rpc = supabase.rpc('fuel_commit_delete', {
      p_company_id: companyId, p_expected_revision: expectedRevision,
      p_kind: action.kind, p_id: action.id, p_event: event,
    });
  }

  const { data: newRevision, error } = await rpc;
  const conflict = asConflictError(error);
  if (conflict) throw conflict;
  if (storagePathToRemove) await supabase.storage.from('fuel-receipts').remove([storagePathToRemove]); // best-effort, la fila ya se borró
  next.revision = newRevision as number;
  return next;
}

export async function commitExpenseAction(formData: FormData, expectedRevision: number, companyId = DEFAULT_COMPANY_ID): Promise<FuelState> {
  const supabase = supabaseServer();
  const state = await getFuelState(companyId);
  const file = formData.get('receipt') as File | null;
  const hasFile = Boolean(file && file.size > 0);
  const record: Expense = {
    id: String(formData.get('id') || randomUUID()),
    category: String(formData.get('category')) as ExpenseCategory,
    amount: Number(formData.get('amount')),
    date: String(formData.get('date')),
    driverId: String(formData.get('driverId') || ''),
    truckId: String(formData.get('truckId') || ''),
    loadRef: String(formData.get('loadRef') || ''),
    paymentMethod: String(formData.get('paymentMethod') || ''),
    notes: String(formData.get('notes') || ''),
    status: String(formData.get('status')) as TxStatus,
    receiptFilename: hasFile ? file!.name : (String(formData.get('existingReceiptFilename') || '') || undefined),
  };
  const reason = String(formData.get('reason') || '');
  const action: FuelAction = { type: 'expense', record, receiptFile: hasFile ? file! : undefined, reason };
  const now = new Date().toISOString();
  const id = randomUUID();
  const next = applyFuelAction(state, action, now, id); // valida tipo/tamaño/fechas antes de tocar Storage
  const e = next.expenses.find(x => x.id === record.id)!;

  let storagePath: string | null = null;
  if (hasFile) {
    storagePath = `${companyId}/${e.id}/${file!.name}`;
    const upload = await supabase.storage.from('fuel-receipts').upload(storagePath, file!, { contentType: file!.type, upsert: true });
    if (upload.error) throw new Error(upload.error.message);
  }

  const { data: newRevision, error } = await supabase.rpc('fuel_commit_expense', {
    p_company_id: companyId, p_expected_revision: expectedRevision,
    p_expense: {
      id: e.id, category: e.category, amount: e.amount, date: e.date, driver_id: e.driverId || null, truck_id: e.truckId || null,
      load_ref: e.loadRef, payment_method: e.paymentMethod, notes: e.notes, status: e.status,
      receipt_filename: hasFile ? file!.name : null,
      receipt_storage_path: storagePath,
      receipt_size_bytes: hasFile ? file!.size : null,
      receipt_uploaded_at: hasFile ? now : null,
    },
    p_event: eventPayload(next),
  });
  const conflict = asConflictError(error);
  if (conflict) {
    if (storagePath) await supabase.storage.from('fuel-receipts').remove([storagePath]); // deshace el upload huérfano
    throw conflict;
  }
  next.revision = newRevision as number;
  return next;
}

export async function getExpenseReceiptUrl(expenseId: string, companyId = DEFAULT_COMPANY_ID): Promise<string> {
  const supabase = supabaseServer();
  const { data, error } = await supabase.from('expenses').select('receipt_storage_path').eq('id', expenseId).eq('company_id', companyId).single();
  if (error || !data?.receipt_storage_path) throw new Error('No se encontró el recibo.');
  const signed = await supabase.storage.from('fuel-receipts').createSignedUrl(data.receipt_storage_path, 60);
  if (signed.error || !signed.data) throw new Error('No se pudo generar el enlace de descarga.');
  return signed.data.signedUrl;
}
