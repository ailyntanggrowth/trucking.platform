'use server';
// Server Action del botón "Sincronizar Google Sheets" en Cargas (pedido
// explícito) — misma lógica que corre sola una vez al día por el Cron (ver
// lib/sheet-sync-run.ts), solo que disparada a mano cuando la dueña la
// necesita al momento, sin esperar al Cron.
import { runSheetSync, type SheetSyncResult } from './sheet-sync-run';
import { DEFAULT_COMPANY_ID } from './supabase-server';
import { requireCaller, STAFF } from './auth-guard';

// La Hoja de Google configurada en Vercel (GOOGLE_SHEET_ID) es la de M&A.
// Hasta que cada compañía tenga su propia hoja, solo M&A puede sincronizarla —
// si no, un administrador de otra compañía importaría las cargas de M&A a la suya.
export async function syncGoogleSheetAction(accessToken: string, dryRun = false): Promise<SheetSyncResult> {
  const { companyId } = await requireCaller(accessToken, STAFF);
  if (companyId !== DEFAULT_COMPANY_ID) throw new Error('Esta compañía no tiene una Hoja de Google conectada.');
  return runSheetSync(dryRun, companyId);
}
