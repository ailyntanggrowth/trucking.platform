// Sincronización con la Hoja de Google de resumen semanal (pedido
// explícito: "la fila de la hoja sería el registro" — cada fila de la
// tabla es la carga oficial, no hace falta registrarla aparte a mano).
// Puramente lector/parser — no toca Supabase aquí, eso vive en
// app/api/sheet-sync/route.ts para poder probarlo aislado.

export type SheetRow = {
  driverNameRaw: string; group: 'Mario' | 'Owner Operators' | 'Lázaro' | 'Dionisio';
  loadNumber: string; amount: number; pickupState: string; deliveryState: string;
  pickupDate: string; deliveryDate: string; paid: boolean;
};

// Prefijo corto de cada mes (nunca tiene errores de tipeo en la práctica,
// a diferencia del nombre completo — visto real: "septiembe" en vez de
// "septiembre", falta una letra en medio, no al final).
const MONTH_PREFIX: [string, string][] = [
  ['ener', '01'], ['febr', '02'], ['marz', '03'], ['abri', '04'], ['mayo', '05'], ['juni', '06'],
  ['juli', '07'], ['agos', '08'], ['sept', '09'], ['octu', '10'], ['novi', '11'], ['dici', '12'],
];
function monthFromTitle(title: string): string | null {
  const norm = title.toLocaleLowerCase();
  return MONTH_PREFIX.find(([prefix]) => norm.includes(prefix))?.[1] ?? null;
}

function parseDayRange(entregas: string, monthNum: string, year: number): { pickupDate: string; deliveryDate: string } | null {
  const m = entregas.match(/(\d{1,2})\s*-\s*(\d{1,2})/);
  if (!m) return null;
  const pDay = Number(m[1]), dDay = Number(m[2]);
  if (!pDay || !dDay || pDay > 31 || dDay > 31) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  let dMonth = Number(monthNum);
  if (dDay < pDay) dMonth += 1; // cruza a principios del mes siguiente
  const dMonthWrapped = dMonth > 12 ? 1 : dMonth;
  const dYear = dMonth > 12 ? year + 1 : year;
  return {
    pickupDate: `${year}-${monthNum}-${pad(pDay)}`,
    deliveryDate: `${dYear}-${pad(dMonthWrapped)}-${pad(dDay)}`,
  };
}

const GROUP_HEADERS: { match: RegExp; group: SheetRow['group'] }[] = [
  { match: /owner\s*operators?/i, group: 'Owner Operators' },
  { match: /l[aá]zaro/i, group: 'Lázaro' },
  { match: /dionisio/i, group: 'Dionisio' },
];

export function parseSheetRows(csvRows: string[][], year = new Date().getFullYear()): { rows: SheetRow[]; unparsed: { raw: string[]; reason: string }[] } {
  const title = (csvRows[0]?.[0] || '').trim();
  const monthNum = monthFromTitle(title);
  const rows: SheetRow[] = [];
  const unparsed: { raw: string[]; reason: string }[] = [];
  let currentGroup: SheetRow['group'] = 'Mario';

  for (const row of csvRows.slice(1)) {
    const [driverName, loadNumber, amountStr, destino, entregas, summar] = row.map(c => (c || '').trim());
    if (!driverName && !loadNumber) continue; // fila vacía
    if (/^choferes$/i.test(driverName)) continue; // encabezado de columnas

    // Una fila de encabezado de grupo (ej. "owner operators") viene de una
    // celda combinada en la Hoja — al exportar a CSV, Google repite ese
    // mismo texto en TODAS las columnas que abarcaba la combinación, así
    // que no se puede usar "sin número de carga" como pista; se detecta
    // solo por el texto del nombre.
    const groupHeader = GROUP_HEADERS.find(g => g.match.test(driverName));
    if (groupHeader) { currentGroup = groupHeader.group; continue; }

    if (!loadNumber || !amountStr) { unparsed.push({ raw: row, reason: 'Falta el número de carga o el precio.' }); continue; }
    const amount = Number(amountStr.replace(/[^0-9.]/g, ''));
    if (!amount) { unparsed.push({ raw: row, reason: 'El precio no es un número válido.' }); continue; }

    const destinoMatch = destino.match(/^([A-Za-z]{2})\s*-\s*([A-Za-z]{2})$/);
    if (!destinoMatch) { unparsed.push({ raw: row, reason: `La columna de destino ("${destino}") no tiene el formato "XX-XX".` }); continue; }

    if (!monthNum) { unparsed.push({ raw: row, reason: `No se pudo saber el mes a partir del título de la hoja ("${title}").` }); continue; }
    const dates = parseDayRange(entregas, monthNum, year);
    if (!dates) { unparsed.push({ raw: row, reason: `La columna de fechas ("${entregas}") no tiene el formato "día-día".` }); continue; }

    rows.push({
      driverNameRaw: driverName, group: currentGroup, loadNumber,
      amount, pickupState: destinoMatch[1].toUpperCase(), deliveryState: destinoMatch[2].toUpperCase(),
      pickupDate: dates.pickupDate, deliveryDate: dates.deliveryDate,
      paid: /^list/i.test(summar),
    });
  }
  return { rows, unparsed };
}

// Nombre del chofer en la hoja (ej. "gilberto") contra el nombre completo ya
// registrado (ej. "Gilberto Jimenez") — coincide si el nombre de la hoja es
// el principio del nombre completo, sin acentos ni mayúsculas.
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
export function matchDriver(sheetName: string, drivers: { id: string; name: string }[]): { id: string; name: string } | null {
  const n = normalize(sheetName);
  return drivers.find(d => normalize(d.name).startsWith(n) || n.startsWith(normalize(d.name))) || null;
}
