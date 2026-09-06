// Lector determinista del statement semanal de Mudflap (PDF → filas de
// Combustible y Gastos). No usa IA para interpretar montos: solo texto
// extraído del PDF (pdf-parse) contra un formato de tabla conocido y estable.
// Ver spec 8.2 (Mudflap como fuente de datos) y 6.5 (la extracción es
// asistencia, no autoridad final — el usuario revisa y confirma cada fila).

export type MudflapRow = {
  date: string; // YYYY-MM-DD
  type: 'Fuel' | 'Non-Fuel';
  station: string;
  city: string;
  state: string;
  driverNameRaw: string;
  cardLast4: string;
  retailPrice: number;
  amount: number;
  saved: number;
  externalRef: string;
  raw: string;
};

export type MudflapParseResult = {
  period: { start: string; end: string } | null;
  rows: MudflapRow[];
  unparsed: { raw: string; reason: string }[];
  declared: { fuel: number | null; nonFuel: number | null; total: number | null };
  totals: { fuel: number; nonFuel: number; total: number };
};

const MONTHS: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const norm = (s: string) => s.replace(/[ \t]+/g, ' ').trim();
const money = (s: string) => Number(s.replace(/[^0-9.-]/g, ''));

function inferYear(month: string, periodEnd: { y: number; m: number } | null): number {
  if (!periodEnd) return new Date().getFullYear();
  const m = Number(MONTHS[month]);
  // Semana que cruza fin de año: si el mes de la fila es dic. y el statement termina en enero, es el año anterior.
  if (m === 12 && periodEnd.m === 1) return periodEnd.y - 1;
  return periodEnd.y;
}

function parseCityState(segment: string): { city: string; state: string } {
  const m = segment.match(/^\s*([^,]+?),\s*([A-Z]{2})\b/);
  return m ? { city: m[1].trim(), state: m[2] } : { city: '', state: '' };
}

function parseDescription(desc: string): { station: string; city: string; state: string } {
  const parts = desc.split('|').map(p => p.trim());
  const stationPart = parts[0] || '';
  const addressPart = (parts.find(p => /^Address:/i.test(p)) || '').replace(/^Address:\s*/i, '');
  const dash = stationPart.match(/^(.*?)\s+-\s+(.+)$/);
  if (dash) {
    const { city, state } = parseCityState(dash[2]);
    if (city) return { station: dash[1].trim(), city, state };
    return { station: dash[1].trim(), ...parseCityState(addressPart) };
  }
  return { station: stationPart, ...parseCityState(addressPart) };
}

export function parseMudflapText(text: string): MudflapParseResult {
  const lines = text.split('\n').map(l => norm(l)).filter(l => l.length > 0);

  let period: MudflapParseResult['period'] = null;
  const periodMatch = text.match(/Billing\s*Period[\s\S]{0,120}?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*(\d{1,2}),\s*(\d{4})\s*-\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*(\d{1,2}),\s*(\d{4})/i);
  let periodEndYM: { y: number; m: number } | null = null;
  if (periodMatch) {
    const [, m1, d1, y1, m2, d2, y2] = periodMatch;
    const cap = (s: string) => s[0].toUpperCase() + s.slice(1, 3).toLowerCase();
    period = { start: `${y1}-${MONTHS[cap(m1)]}-${d1.padStart(2, '0')}`, end: `${y2}-${MONTHS[cap(m2)]}-${d2.padStart(2, '0')}` };
    periodEndYM = { y: Number(y2), m: Number(MONTHS[cap(m2)]) };
  }

  const declared = {
    fuel: (text.match(/Fuel\s*Purchases\$?([\d,]+\.\d{2})/i) || [])[1] ? money((text.match(/Fuel\s*Purchases\$?([\d,]+\.\d{2})/i) as RegExpMatchArray)[1]) : null,
    nonFuel: (text.match(/Non-Fuel\s*Purchases\$?([\d,]+\.\d{2})/i) || [])[1] ? money((text.match(/Non-Fuel\s*Purchases\$?([\d,]+\.\d{2})/i) as RegExpMatchArray)[1]) : null,
    total: (text.match(/Total\s*Purchases\$?([\d,]+\.\d{2})/i) || [])[1] ? money((text.match(/Total\s*Purchases\$?([\d,]+\.\d{2})/i) as RegExpMatchArray)[1]) : null,
  };

  // Recorta a la sección "Purchases" (excluye Payments & Credits y el pie del documento).
  const startIdx = lines.findIndex(l => /^Purchase\s*Date\s*Type\s*Description/i.test(l));
  const endIdx = lines.findIndex(l => /^Total\s*Purchases/i.test(l));
  const section = startIdx >= 0 ? lines.slice(startIdx + 1, endIdx >= 0 ? endIdx : undefined) : [];

  const DATE_TYPE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(Fuel|Non-Fuel)$/;
  const CARD_RETAIL = /^\*{3,4}\s*(\d{4})\$([\d,]+\.\d{2})$/;
  const BARE_AMOUNT = /^\$([\d,]+\.\d{2})$/;
  const SAVED = /^\$([\d,]+\.\d{2})\s*Saved$/i;

  // Agrupa por bloques: cada bloque empieza en un match de DATE_TYPE y llega
  // hasta el siguiente. Dentro del bloque, cada campo se busca por su propia
  // forma (no por posición fija) — así una línea "..." de truncamiento, o un
  // salto de página que reordena el bloque, no rompen el resto de los campos.
  type Block = { date: string; type: 'Fuel' | 'Non-Fuel'; lines: string[] };
  const blocks: Block[] = [];
  for (const line of section) {
    const m = line.match(DATE_TYPE);
    if (m) {
      const year = inferYear(m[1], periodEndYM);
      const date = `${year}-${MONTHS[m[1]]}-${m[2].padStart(2, '0')}`;
      blocks.push({ date, type: m[3] as 'Fuel' | 'Non-Fuel', lines: [] });
    } else if (blocks.length) {
      blocks[blocks.length - 1].lines.push(line);
    }
  }

  const rows: MudflapRow[] = [];
  const unparsed: MudflapParseResult['unparsed'] = [];

  for (const block of blocks) {
    const raw = `${block.date} ${block.type}\n${block.lines.join('\n')}`;
    const descLine = block.lines.find(l => l.includes('SID'));
    const cardLine = block.lines.map(l => l.match(CARD_RETAIL)).find(Boolean);
    const savedLine = block.lines.map(l => l.match(SAVED)).find(Boolean);
    // El monto real es la línea "$X.XX" suelta que NO es el precio de venta
    // (ya capturado dentro de cardLine) ni la línea de "Saved".
    const bareAmounts = block.lines.filter(l => BARE_AMOUNT.test(l) && !SAVED.test(l));
    const driverLine = block.lines.find(l => l !== descLine && !l.includes('SID') && l !== '...' && !CARD_RETAIL.test(l) && !SAVED.test(l) && !BARE_AMOUNT.test(l) && l.length > 0);

    if (!descLine || !cardLine || !bareAmounts.length) {
      unparsed.push({ raw, reason: !descLine ? 'No se encontró la descripción de la estación (posible salto de página).' : !cardLine ? 'No se encontró la tarjeta/precio de venta.' : 'No se encontró el monto cobrado.' });
      continue;
    }
    const { station, city, state } = parseDescription(descLine);
    const sid = (descLine.match(/SID\s*([A-Za-z0-9]+)/) || [])[1] || '';
    rows.push({
      date: block.date, type: block.type, station, city, state,
      driverNameRaw: driverLine || '', cardLast4: cardLine[1], retailPrice: money(cardLine[2]),
      amount: money(bareAmounts[0]), saved: savedLine ? money(savedLine[1]) : 0,
      externalRef: sid ? `SID${sid}` : '', raw,
    });
  }

  const totals = rows.reduce((acc, r) => { if (r.type === 'Fuel') acc.fuel += r.amount; else acc.nonFuel += r.amount; acc.total += r.amount; return acc; }, { fuel: 0, nonFuel: 0, total: 0 });
  const round2 = (n: number) => Math.round(n * 100) / 100;
  totals.fuel = round2(totals.fuel); totals.nonFuel = round2(totals.nonFuel); totals.total = round2(totals.total);

  return { period, rows, unparsed, declared, totals };
}
