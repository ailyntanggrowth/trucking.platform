'use server';
// Server Action del botón "Sincronizar Google Sheets" en Cargas (pedido
// explícito) — misma lógica que corre sola una vez al día por el Cron (ver
// lib/sheet-sync-run.ts), solo que disparada a mano cuando la dueña la
// necesita al momento, sin esperar al Cron.
import { runSheetSync, type SheetSyncResult } from './sheet-sync-run';
import { DEFAULT_COMPANY_ID } from './supabase-server';

export async function syncGoogleSheetAction(dryRun = false, companyId = DEFAULT_COMPANY_ID): Promise<SheetSyncResult> {
  return runSheetSync(dryRun, companyId);
}
