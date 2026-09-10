// Lector determinista del "Purchase Summary Report" de Summar (factoring),
// mismo espíritu que lib/mudflap.ts: solo texto extraído del PDF contra un
// formato de tabla conocido y estable — no usa IA para interpretar montos.
// Ver spec 9.8 (Summar). La extracción es asistencia, no autoridad final: el
// usuario revisa y confirma cada fila antes de guardar nada (lib/loads-actions.ts).
//
// Diseño deliberado: en vez de intentar parsear genéricamente TODAS las filas
// de la tabla (nombre de cliente, "None", etc. — texto libre y variable), se
// busca directamente cada número de carga YA REGISTRADO en el sistema dentro
// del texto del PDF. Esto evita tener que adivinar dónde termina el nombre
// del cliente y empieza la carga siguiente, y como consecuencia nunca
// "inventa" una carga que no exista — si un invoice del PDF no está
// registrado en Cargas, simplemente no aparece en el resultado.

export type SummarSection = 'Purchased' | 'Denied' | string;

export type SummarMatch = {
  loadNumber: string;
  section: SummarSection;
  denied: boolean; // true si esta ocurrencia trae sufijo DNY o cayó en la sección "Denied"
  invoiceDate: string; // YYYY-MM-DD
  invoiceAmount: number;
  escrowReserve: number; // siempre negativo o cero
  fundedAmount: number;
};

export type SummarParseResult = {
  reportDate: string | null; // "For: MM/DD/YYYY" al inicio del documento
  matches: SummarMatch[];
};

const money = (s: string) => Number(s.replace(/[$,]/g, ''));

// Cada sección de la tabla ("Purchased", "Denied", y cualquier otra que
// Summar agregue en el futuro, ej. "Held") siempre viene seguida del
// encabezado "Invoice Date  Inv No  Customer Name" — eso es lo único fijo
// que se usa para ubicar dónde empieza cada sección, sin asumir una lista
// cerrada de nombres posibles.
function findSections(flat: string): { name: SummarSection; start: number; end: number }[] {
  const headers: { name: string; idx: number }[] = [];
  const re = /\b([A-Za-z]+)\s+Invoice Date\s+Inv No\s+Customer Name/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat))) headers.push({ name: m[1].trim(), idx: m.index });
  return headers.map((h, i) => ({ name: h.name, start: h.idx, end: i + 1 < headers.length ? headers[i + 1].idx : flat.length }));
}

export function parseSummarText(text: string, knownLoadNumbers: string[]): SummarParseResult {
  const flat = text.replace(/\s+/g, ' ').trim();

  const reportDateMatch = flat.match(/For:\s*(\d{2})\/(\d{2})\/(\d{4})/);
  const reportDate = reportDateMatch ? `${reportDateMatch[3]}-${reportDateMatch[1]}-${reportDateMatch[2]}` : null;

  const sections = findSections(flat);
  const matches: SummarMatch[] = [];

  // Se ordena del número de carga más largo al más corto para que, si uno
  // fuera prefijo literal de otro (caso raro pero posible), el más largo se
  // intente encontrar primero.
  const candidates = Array.from(new Set(knownLoadNumbers)).filter(Boolean).sort((a, b) => b.length - a.length);

  for (const inv of candidates) {
    const escaped = inv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Summar a veces antepone un cero a la izquierda al número de carga que
    // el sistema guarda sin él (visto en PDFs reales: "0101185" en el PDF vs
    // "101185" en el sistema) — se admite ese cero opcional cuando el número
    // es puramente numérico, sin afectar códigos alfanuméricos (ej. "MB625264").
    const withOptionalZero = /^\d+$/.test(inv) ? `0?${escaped}` : escaped;
    // Ancla en la fecha de la fila (MM/DD/YYYY) seguida del número de carga
    // exacto — con o sin espacio, y con o sin sufijo "DNY"/"DNY1"/"DNY2..."
    // pegado directamente (el PDF a veces no deja espacio entre el sufijo y
    // el nombre del cliente que sigue). Luego admite hasta 200 caracteres de
    // relleno (nombre de cliente, "None", etc.) antes de los tres montos.
    const re = new RegExp(
      `(\\d{2}/\\d{2}/\\d{4})\\s*${withOptionalZero}(DNY\\d*)?(?=[^A-Za-z0-9-]|$)[\\s\\S]{0,200}?\\$(-?[\\d,]+\\.\\d{2})\\s*\\$(-?[\\d,]+\\.\\d{2})\\s*\\$(-?[\\d,]+\\.\\d{2})`,
      'g',
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(flat))) {
      const [, dateStr, dnySuffix, invAmtStr, escrowStr, fundedStr] = m;
      const [mo, da, yr] = dateStr.split('/');
      const section = sections.find(s => m!.index >= s.start && m!.index < s.end)?.name || 'Purchased';
      matches.push({
        loadNumber: inv,
        section,
        denied: Boolean(dnySuffix) || /denied/i.test(section),
        invoiceDate: `${yr}-${mo}-${da}`,
        invoiceAmount: money(invAmtStr),
        escrowReserve: money(escrowStr),
        fundedAmount: money(fundedStr),
      });
    }
  }

  return { reportDate, matches };
}
