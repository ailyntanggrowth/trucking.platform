'use server';
import { randomUUID } from 'node:crypto';
import { applyFleetAction, assignmentFor, type FleetAction, type FleetState } from './fleet';
import { supabaseServer, DEFAULT_COMPANY_ID } from './supabase-server';

const CONFLICT_MESSAGE = 'Los datos cambiaron en otro dispositivo o pestaña. Actualiza y vuelve a intentarlo.';

function asConflictError(error: { message?: string } | null) {
  if (error?.message === 'REVISION_CONFLICT') return new Error(CONFLICT_MESSAGE);
  return error ? new Error(error.message) : null;
}

// Instancias reales de Blob/File (incluida la que sube el propio usuario en 'document')
// no se pueden serializar de vuelta a un Client Component — React las rechaza con
// "Only plain objects... Classes... are not supported". El archivo real vive en Storage;
// aquí solo viaja un objeto plano de relleno para satisfacer el tipo FleetDocument.file.
const FILE_PLACEHOLDER = {} as unknown as Blob;
function forClient(state: FleetState): FleetState {
  return { ...state, documents: state.documents.map(d => ({ ...d, file: FILE_PLACEHOLDER })) };
}

export async function getFleetState(companyId = DEFAULT_COMPANY_ID): Promise<FleetState> {
  const supabase = supabaseServer();
  const [meta, drivers, equipment, assignments, documents, events] = await Promise.all([
    supabase.from('fleet_meta').select('revision, warning_days').eq('company_id', companyId).single(),
    supabase.from('drivers').select('*').eq('company_id', companyId),
    supabase.from('equipment').select('*').eq('company_id', companyId),
    supabase.from('assignments').select('*').eq('company_id', companyId),
    supabase.from('fleet_documents').select('*').eq('company_id', companyId),
    supabase.from('fleet_events').select('*').eq('company_id', companyId).order('seq', { ascending: false }),
  ]);
  for (const result of [meta, drivers, equipment, assignments, documents, events]) {
    if (result.error) throw new Error(result.error.message);
  }
  return {
    schema: 1,
    revision: meta.data!.revision,
    warningDays: meta.data!.warning_days,
    drivers: (drivers.data ?? []).map(r => ({
      id: r.id, name: r.name, phone: r.phone, email: r.email, group: r.group_name,
      active: r.active, availability: r.availability, notes: r.notes,
    })),
    trucks: (equipment.data ?? []).filter(r => r.kind === 'trucks').map(mapEquipmentRow),
    trailers: (equipment.data ?? []).filter(r => r.kind === 'trailers').map(mapEquipmentRow),
    assignments: (assignments.data ?? []).map(r => ({
      id: r.id, driverId: r.driver_id, truckId: r.truck_id, trailerId: r.trailer_id ?? '',
      startedAt: r.started_at, endedAt: r.ended_at ?? undefined, reason: r.reason, endReason: r.end_reason ?? undefined,
    })),
    documents: (documents.data ?? []).map(r => ({
      id: r.id, ownerKind: r.owner_kind, ownerId: r.owner_id, type: r.type,
      issued: r.issued ?? '', expires: r.expires ?? '', reviewed: r.reviewed, notes: r.notes,
      filename: r.filename, file: FILE_PLACEHOLDER, sizeBytes: Number(r.size_bytes),
      uploadedAt: r.uploaded_at, reviewedAt: r.reviewed_at ?? undefined,
    })),
    events: (events.data ?? []).map(r => ({
      id: r.id, at: r.at, actor: r.actor, entityIds: r.entity_ids, detail: r.detail,
      before: r.before, after: r.after,
    })),
  };
}

function mapEquipmentRow(r: Record<string, any>) {
  return {
    id: r.id, unit: r.unit, vin: r.vin, plate: r.plate, plateState: r.plate_state,
    year: r.year, make: r.make, model: r.model, type: r.type, status: r.status, notes: r.notes,
  };
}

function eventPayload(next: FleetState) {
  const e = next.events[0];
  return { id: e.id, at: e.at, actor: e.actor, entity_ids: e.entityIds, detail: e.detail, before: e.before, after: e.after };
}

// Acciones sin archivo: driver, equipment, assign, end, reviewDocument, warningDays.
// El caso 'document' (con File) va por commitDocumentAction, ver abajo.
export async function commitFleetAction(action: Exclude<FleetAction, { type: 'document' }>, expectedRevision: number, companyId = DEFAULT_COMPANY_ID): Promise<FleetState> {
  const supabase = supabaseServer();
  const state = await getFleetState(companyId);
  const now = new Date().toISOString();
  const id = randomUUID();

  let previousAssignmentId: string | null = null;
  if (action.type === 'assign') previousAssignmentId = assignmentFor(state, 'drivers', action.driverId)?.id ?? null;

  const next = applyFleetAction(state, action, now, id);
  const event = eventPayload(next);
  let rpc;
  let storagePathToRemove: string | null = null;

  if (action.type === 'driver') {
    const d = next.drivers.find(x => x.id === action.record.id)!;
    rpc = supabase.rpc('fleet_commit_driver', {
      p_company_id: companyId, p_expected_revision: expectedRevision,
      p_driver: { id: d.id, name: d.name, phone: d.phone, email: d.email, group_name: d.group, active: d.active, availability: d.availability, notes: d.notes },
      p_event: event,
    });
  } else if (action.type === 'equipment') {
    const e = next[action.kind].find(x => x.id === action.record.id)!;
    rpc = supabase.rpc('fleet_commit_equipment', {
      p_company_id: companyId, p_expected_revision: expectedRevision,
      p_equipment: { id: e.id, kind: action.kind, unit: e.unit, vin: e.vin, plate: e.plate, plate_state: e.plateState, year: e.year, make: e.make, model: e.model, type: e.type, status: e.status, notes: e.notes },
      p_event: event,
    });
  } else if (action.type === 'assign') {
    const a = next.assignments[next.assignments.length - 1];
    rpc = supabase.rpc('fleet_commit_assign', {
      p_company_id: companyId, p_expected_revision: expectedRevision,
      p_old_assignment_id: previousAssignmentId, p_old_ended_at: previousAssignmentId ? now : null, p_old_end_reason: previousAssignmentId ? action.reason.trim() : null,
      p_new_assignment: { id: a.id, driver_id: a.driverId, truck_id: a.truckId, trailer_id: a.trailerId, started_at: a.startedAt, reason: a.reason },
      p_event: event,
    });
  } else if (action.type === 'end') {
    const a = next.assignments.find(x => x.id === action.id)!;
    rpc = supabase.rpc('fleet_commit_end_assignment', {
      p_company_id: companyId, p_expected_revision: expectedRevision,
      p_assignment_id: a.id, p_ended_at: a.endedAt, p_end_reason: a.endReason,
      p_event: event,
    });
  } else if (action.type === 'reviewDocument') {
    const d = next.documents.find(x => x.id === action.id)!;
    rpc = supabase.rpc('fleet_commit_review_document', {
      p_company_id: companyId, p_expected_revision: expectedRevision,
      p_document_id: d.id, p_reviewed: d.reviewed, p_reviewed_at: d.reviewedAt ?? null,
      p_event: event,
    });
  } else if (action.type === 'delete') {
    rpc = supabase.rpc('fleet_commit_delete_entity', {
      p_company_id: companyId, p_expected_revision: expectedRevision,
      p_kind: action.kind, p_entity_id: action.id, p_event: event,
    });
  } else if (action.type === 'deleteDocument') {
    const { data: pathRow } = await supabase.from('fleet_documents').select('storage_path').eq('id', action.id).eq('company_id', companyId).single();
    storagePathToRemove = pathRow?.storage_path ?? null;
    rpc = supabase.rpc('fleet_commit_delete_document', {
      p_company_id: companyId, p_expected_revision: expectedRevision,
      p_document_id: action.id, p_event: event,
    });
  } else {
    rpc = supabase.rpc('fleet_commit_warning_days', {
      p_company_id: companyId, p_expected_revision: expectedRevision,
      p_warning_days: next.warningDays, p_event: event,
    });
  }

  const { data: newRevision, error } = await rpc;
  const conflict = asConflictError(error);
  if (conflict) throw conflict;
  if (storagePathToRemove) await supabase.storage.from('fleet-documents').remove([storagePathToRemove]); // best-effort, la fila ya se borró
  next.revision = newRevision as number;
  return forClient(next);
}

export async function commitDocumentAction(formData: FormData, expectedRevision: number, companyId = DEFAULT_COMPANY_ID): Promise<FleetState> {
  const supabase = supabaseServer();
  const state = await getFleetState(companyId);
  const file = formData.get('file') as File;
  const action: FleetAction = {
    type: 'document',
    record: {
      ownerKind: formData.get('ownerKind') as any, ownerId: String(formData.get('ownerId')),
      type: String(formData.get('documentType')), issued: String(formData.get('issued') || ''),
      expires: String(formData.get('expires') || ''), reviewed: false, notes: String(formData.get('notes') || ''),
      filename: file.name, file,
    },
  };
  const now = new Date().toISOString();
  const id = randomUUID();
  const next = applyFleetAction(state, action, now, id); // valida tipo/tamaño/fechas antes de tocar Storage
  const doc = next.documents.find(d => d.id === id)!;
  const storagePath = `${companyId}/${id}/${file.name}`;

  const upload = await supabase.storage.from('fleet-documents').upload(storagePath, file, { contentType: file.type, upsert: false });
  if (upload.error) throw new Error(upload.error.message);

  const { data: newRevision, error } = await supabase.rpc('fleet_commit_document', {
    p_company_id: companyId, p_expected_revision: expectedRevision,
    p_document: {
      id: doc.id, owner_kind: doc.ownerKind, owner_id: doc.ownerId, type: doc.type,
      issued: doc.issued || null, expires: doc.expires || null, notes: doc.notes,
      filename: doc.filename, storage_path: storagePath, size_bytes: file.size,
    },
    p_event: eventPayload(next),
  });
  const conflict = asConflictError(error);
  if (conflict) {
    await supabase.storage.from('fleet-documents').remove([storagePath]); // deshace el upload huérfano
    throw conflict;
  }
  next.revision = newRevision as number;
  return forClient(next);
}

export async function getFleetDocumentUrl(documentId: string, companyId = DEFAULT_COMPANY_ID): Promise<string> {
  const supabase = supabaseServer();
  const { data, error } = await supabase.from('fleet_documents').select('storage_path').eq('id', documentId).eq('company_id', companyId).single();
  if (error || !data) throw new Error('No se encontró el documento.');
  const signed = await supabase.storage.from('fleet-documents').createSignedUrl(data.storage_path, 60);
  if (signed.error || !signed.data) throw new Error('No se pudo generar el enlace de descarga.');
  return signed.data.signedUrl;
}
