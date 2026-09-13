// Sincronización con la Hoja de Google de cargas (pedido explícito: "la fila
// de la hoja sería el registro" — cada fila de la tabla es la carga oficial,
// no hace falta registrarla aparte a mano). Puramente lector/parser — no
// toca Supabase aquí, eso vive en lib/sheet-sync-run.ts.
//
// El archivo tiene UNA PESTAÑA POR SEMANA (pedido explícito: "no quiero un
// archivo diferente cada semana"), así que esto se corre una vez por cada
// pestaña — ver fetchAllPrivateSheetTabs en lib/google-sheets.ts.

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
function yearFromTitle(title: string): number | null {
  const m = title.match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : null;
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
const isHeaderOrGroupRow = (driverName: string) => /^choferes$/i.test(driverName) || GROUP_HEADERS.some(g => g.match.test(driverName));
// Una fila "parece" una carga real (chofer + número + precio) — se usa solo
// para decidir si una pestaña es de cargas en absoluto, antes de intentar
// leerle el mes.
const looksLikeDataRow = (row: string[]) => {
  const [driverName, loadNumber, amountStr] = row.map(c => (c || '').trim());
  if (isHeaderOrGroupRow(driverName)) return false;
  const amount = Number((amountStr || '').replace(/[^0-9.]/g, ''));
  return Boolean(loadNumber) && amount > 0;
};

export function parseSheetRows(csvRows: string[][], opts: { year?: number; titleHint?: string } = {}): { rows: SheetRow[]; unparsed: { raw: string[]; reason: string }[]; skipped: boolean } {
  // La API de Sheets a veces sí incluye filas completamente en blanco al
  // principio (la hoja privada de cargas trae una) que el export CSV
  // público no traía — se ignoran para que el título quede en la posición
  // correcta sin importar cuántas filas en blanco haya antes.
  const isBlankRow = (row: string[]) => row.length === 0 || row.every(c => !c || !c.trim());
  let start = 0;
  while (start < csvRows.length && isBlankRow(csvRows[start])) start++;
  const dataRows = csvRows.slice(start);

  // El mes/año se busca primero en el NOMBRE DE LA PESTAÑA (ej. "8-14
  // SEPTIEMBRE" o "8-14 SEPTIEMBRE 2026" — pedido explícito: una pestaña por
  // semana) y, si ahí no aparece, en la primera fila de la pestaña (formato
  // viejo, ej. "RESUMEN DEL 8-14 SEPTIEMBRE") — lo que sí sirva.
  const contentTitle = (dataRows[0]?.[0] || '').trim();
  const titleHint = (opts.titleHint || '').trim();
  const monthNum = monthFromTitle(titleHint) || monthFromTitle(contentTitle);
  const year = yearFromTitle(titleHint) ?? yearFromTitle(contentTitle) ?? opts.year ?? new Date().getFullYear();
  const titleForMessages = titleHint || contentTitle;

  const rows: SheetRow[] = [];
  const unparsed: { raw: string[]; reason: string }[] = [];
  let currentGroup: SheetRow['group'] = 'Mario';

  // Si no se le pudo sacar mes ni a la pestaña ni al contenido, y ninguna
  // fila parece una carga real, esta pestaña probablemente no es una semana
  // de cargas (podría ser otra pestaña de la dueña) — se ignora entera y en
  // silencio, en vez de llenar el resultado de errores sin sentido.
  if (!monthNum && !dataRows.slice(1).some(looksLikeDataRow)) return { rows: [], unparsed: [], skipped: true };

  for (const row of dataRows.slice(1)) {
    const [driverName, loadNumber, amountStr, destino, entregas, paymentCell] = row.map(c => (c || '').trim());
    if (!driverName && !loadNumber) continue; // fila vacía
    if (/^choferes$/i.test(driverName)) continue; // encabezado de columnas

    // Una fila de encabezado de grupo (ej. "owner operators") viene de una
    // celda combinada en la Hoja — al exportar, Google repite ese mismo
    // texto en TODAS las columnas que abarcaba la combinación, así que no se
    // puede usar "sin número de carga" como pista; se detecta solo por el
    // texto del nombre.
    const groupHeader = GROUP_HEADERS.find(g => g.match.test(driverName));
    if (groupHeader) { currentGroup = groupHeader.group; continue; }

    if (!loadNumber || !amountStr) { unparsed.push({ raw: row, reason: 'Falta el número de carga o el precio.' }); continue; }
    const amount = Number(amountStr.replace(/[^0-9.]/g, ''));
    if (!amount) { unparsed.push({ raw: row, reason: 'El precio no es un número válido.' }); continue; }

    const destinoMatch = destino.match(/^([A-Za-z]{2})\s*-\s*([A-Za-z]{2})$/);
    if (!destinoMatch) { unparsed.push({ raw: row, reason: `La columna de destino ("${destino}") no tiene el formato "XX-XX".` }); continue; }

    if (!monthNum) { unparsed.push({ raw: row, reason: `No se pudo saber el mes a partir del título ("${titleForMessages}").` }); continue; }
    const dates = parseDayRange(entregas, monthNum, year);
    if (!dates) { unparsed.push({ raw: row, reason: `La columna de fechas ("${entregas}") no tiene el formato "día-día".` }); continue; }

    rows.push({
      driverNameRaw: driverName, group: currentGroup, loadNumber,
      amount, pickupState: destinoMatch[1].toUpperCase(), deliveryState: destinoMatch[2].toUpperCase(),
      pickupDate: dates.pickupDate, deliveryDate: dates.deliveryDate,
      // Estado de pago (pedido explícito): esta columna ya no es "Summar",
      // es "Estado de pago" — misma regla de siempre, LIST = pagada, vacío =
      // pendiente.
      paid: /^list/i.test(paymentCell),
    });
  }
  return { rows, unparsed, skipped: false };
}

// Nombre del chofer en la hoja (ej. "gilberto") contra el nombre completo ya
// registrado (ej. "Gilberto Jimenez") — coincide si el nombre de la hoja es
// el principio del nombre completo, sin acentos ni mayúsculas.
const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase().trim();
export function matchDriver(sheetName: string, drivers: { id: string; name: string }[]): { id: string; name: string } | null {
  const n = normalize(sheetName);
  return drivers.find(d => normalize(d.name).startsWith(n) || n.startsWith(normalize(d.name))) || null;
}
