// Lee una Hoja de Google PRIVADA usando una cuenta de servicio (Service
// Account) — reemplaza el export CSV público que se usaba antes (pedido
// explícito: la hoja de cargas ya no es pública). Sin librerías nuevas: el
// JWT firmado se arma a mano con node:crypto, ya que solo se necesita este
// único flujo (no todo el SDK de Google).
import { createSign } from 'node:crypto';

type ServiceAccount = { client_email: string; private_key: string };

function base64url(input: string) {
  return Buffer.from(input).toString('base64url');
}

function parseServiceAccount(serviceAccountJson: string): ServiceAccount {
  let account: ServiceAccount;
  try { account = JSON.parse(serviceAccountJson); }
  catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON no es un JSON válido — revisa que se haya pegado el archivo completo de la cuenta de servicio.'); }
  if (!account.client_email || !account.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON no tiene client_email o private_key — revisa el archivo de la cuenta de servicio.');
  return account;
}

async function getGoogleAccessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  signer.end();
  const signature = signer.sign(account.private_key).toString('base64url');
  const jwt = `${header}.${claims}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!res.ok) throw new Error(`No se pudo autenticar con la cuenta de servicio de Google (HTTP ${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.access_token as string;
}

export type SheetTab = { title: string; rows: string[][] };

// Devuelve TODAS las pestañas del archivo (pedido explícito: una pestaña
// nueva por semana, "no quiero un archivo diferente cada semana") — antes
// solo se leía la primera. Una sola llamada batchGet trae los datos de
// todas las pestañas de una vez.
export async function fetchAllPrivateSheetTabs(sheetId: string, serviceAccountJson: string): Promise<SheetTab[]> {
  const account = parseServiceAccount(serviceAccountJson);
  const accessToken = await getGoogleAccessToken(account);
  const authHeader = { Authorization: `Bearer ${accessToken}` };

  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`, { headers: authHeader, cache: 'no-store' });
  if (!metaRes.ok) throw new Error(`No se pudo abrir la Hoja de Google (HTTP ${metaRes.status}): ${await metaRes.text()} — revisa que GOOGLE_SHEET_ID sea correcto y que la hoja esté compartida con ${account.client_email}.`);
  const meta = await metaRes.json();
  const titles: string[] = (meta.sheets ?? []).map((s: any) => s.properties?.title).filter(Boolean);
  if (!titles.length) throw new Error('La Hoja de Google no tiene ninguna pestaña.');

  const rangesParam = titles.map(title => `ranges=${encodeURIComponent(`${title}!A1:Z1000`)}`).join('&');
  const valuesRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchGet?${rangesParam}`, { headers: authHeader, cache: 'no-store' });
  if (!valuesRes.ok) throw new Error(`No se pudieron leer los datos de la Hoja (HTTP ${valuesRes.status}): ${await valuesRes.text()}`);
  const valuesData = await valuesRes.json();
  const valueRanges: { values?: string[][] }[] = valuesData.valueRanges ?? [];
  return titles.map((title, i) => ({ title, rows: valueRanges[i]?.values ?? [] }));
}
