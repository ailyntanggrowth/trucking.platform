// Endpoint que sincroniza la Hoja de Google de cargas con Cargas (pedido
// explícito: "la fila de la hoja sería el registro"). Lo llama un Cron de
// Vercel una vez al día (ver vercel.json); la dueña también puede disparar
// esto mismo a mano desde el botón "Sincronizar Google Sheets" en Cargas —
// ver lib/sheet-sync-actions.ts para esa vía y lib/sheet-sync-run.ts para la
// lógica compartida entre las dos.
//
// La hoja ya NO es pública (pedido explícito) — se lee con una cuenta de
// servicio de Google (GOOGLE_SERVICE_ACCOUNT_JSON + GOOGLE_SHEET_ID en
// Vercel), compartida como lectora de la hoja.
//
// Solo API route normal (no Server Action): un Cron de Vercel hace un GET
// HTTP común, no puede invocar una Server Action de Next.js.
import { NextRequest, NextResponse } from 'next/server';
import { runSheetSync } from '../../../lib/sheet-sync-run';

export async function GET(request: NextRequest) {
  // CRON_SECRET es el nombre especial que reconoce Vercel: si existe esa
  // variable de entorno, Vercel agrega solo "Authorization: Bearer <valor>"
  // en cada llamada de su propio Cron — así este endpoint solo responde a
  // llamadas reales del Cron, no a cualquiera que adivine la URL.
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  try {
    const result = await runSheetSync(dryRun);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
