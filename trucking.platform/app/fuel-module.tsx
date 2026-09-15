"use client";
import { useState, type FormEvent } from 'react';
import { summarizeFuel, computeWeeklyFuelSummary, txTotal } from '../lib/fuel';
import type { FuelController } from '../lib/use-fuel';
import { parseMudflapStatementAction, commitStatementImportAction, type MudflapParsePreview } from '../lib/fuel-actions';
import type { FleetController } from '../lib/use-fleet';
import { fuelWeekStartOf, weekRange } from '../lib/settlements';
import { money, dayLabel, shortName, today, weekPeriodLabel } from '../lib/format';
import type { Lang } from '../lib/i18n';
import { Fuel as FuelIcon, ChevronLeft, ChevronRight, Copy, Check, Printer } from 'lucide-react';
import styles from './fuel.module.css';

const groupLabel = (g: string) => g === '' ? 'Chofer sin grupo asignado' : g === 'Mario' ? 'Grupo Mario' : g === 'Owner Operators' ? 'Owner Operators' : g === 'Lázaro' ? 'Grupo Lázaro' : `Grupo ${g}`;

// Gastos (peajes, reparaciones, etc.) se retiró de esta pantalla (pedido
// explícito: "por ahora no lo voy a utilizar") — los datos y las acciones
// siguen intactos en lib/fuel.ts / lib/fuel-actions.ts, solo que sin UI
// aquí. Si más adelante hace falta de vuelta, se recupera del historial.
export default function FuelModule({ fuel, fleet, lang, t }: { fuel: FuelController; fleet: FleetController; lang: Lang; t: (es: string) => string }) {
  const { state, ready } = fuel;
  // Una sola semana (lunes a domingo, igual que el statement real) gobierna
  // todo el módulo — pedido explícito: nada de un rango de fechas libre
  // arriba (mostraba "1 sept – 1 oct" y confundía), siempre semana por
  // semana como en Cargas (Módulo 2), solo que con el calendario de Mudflap.
  const [weekStart, setWeekStart] = useState(fuelWeekStartOf(today()));
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [importOpen, setImportOpen] = useState(false), [importBusy, setImportBusy] = useState(false), [importError, setImportError] = useState('');
  const [preview, setPreview] = useState<MudflapParsePreview | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [rowDriverOverride, setRowDriverOverride] = useState<Record<number, string>>({});
  type ManualUnparsedRow = { date: string; type: 'Fuel' | 'Non-Fuel'; station: string; city: string; state: string; driverId: string; amount: string };
  const [manualUnparsed, setManualUnparsed] = useState<Record<number, ManualUnparsedRow>>({});
  const [openUnparsedIdx, setOpenUnparsedIdx] = useState<number | null>(null);
  const driverName = (id: string) => fleet.state.drivers.find(d => d.id === id)?.name || '';
  const { end: weekEnd, prevWeek, nextWeek } = weekRange(weekStart);
  const summary = summarizeFuel(state, weekStart, weekEnd);
  const weeklySummary = computeWeeklyFuelSummary(state, fleet.state.drivers, weekStart);
  const weekLabel = weekPeriodLabel(weekStart);
  // Semanas con datos guardados (pedido explícito: "las semanas más antiguas
  // guardadas en el historial") — nunca semanas vacías inventadas. La semana
  // actual siempre aparece en la lista aunque todavía no tenga nada, para
  // que se pueda volver a ella con un clic.
  const savedWeeks = Array.from(new Set([fuelWeekStartOf(today()), ...state.transactions.map(t => t.statementWeek)])).sort((a, b) => b.localeCompare(a)).slice(0, 12);
  const weekHistory = savedWeeks.map(ws => ({ weekStart: ws, total: computeWeeklyFuelSummary(state, fleet.state.drivers, ws).grandTotal }));
  function buildResumenText() {
    const lines = ['RESUMEN DE MUDFLAP'];
    weeklySummary.groups.forEach(g => {
      lines.push(groupLabel(g.group));
      g.drivers.forEach(d => lines.push(`${shortName(d.driverName)} — ${money(d.retailAmount)}`));
      if (g.group) lines.push(`Total ${g.group} — ${money(g.retailTotal)}`);
    });
    lines.push(`Total sin descuentos — ${money(weeklySummary.grandRetailTotal)}`);
    lines.push(`Total con descuentos — ${money(weeklySummary.grandTotal)}`);
    return lines.join('\n');
  }
  async function copyResumen() {
    try { await navigator.clipboard.writeText(buildResumenText()); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setError(t('No se pudo copiar — selecciona y copia el texto a mano.')); }
  }
  // "Descargar PDF" (pedido explícito, para mandárselo a Mario mientras no
  // esté integrado al sistema): mismo patrón que Reportes y Mi Invoice —
  // diálogo de impresión nativo, sin librerías nuevas.
  function downloadResumenPdf() {
    const prevTitle = document.title;
    document.title = `Resumen Mudflap - ${weekLabel}`;
    window.print();
    document.title = prevTitle;
  }
  // Top 3 choferes por gasto de combustible (fuel + non-fuel) en el rango — para
  // el panel "Top 3 Choferes", nunca inventado: sale de summary.transactions.
  const topDrivers = Object.entries(summary.transactions.reduce((acc: Record<string, number>, t2) => {
    if (!t2.driverId) return acc; acc[t2.driverId] = (acc[t2.driverId] || 0) + txTotal(t2); return acc;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 3);
  // No se permite importar hasta que no queden filas sin leer y los totales
  // calculados coincidan al centavo con lo que el propio PDF declara — es la
  // única forma de estar seguros de que ninguna transacción quedó afuera. Una
  // fila que el parser no pudo leer (salto de página) se puede completar a
  // mano abajo; una vez completa cuenta para esta reconciliación igual que
  // cualquier otra fila.
  const manualUnparsedRows = Object.values(manualUnparsed);
  const manualTotals = manualUnparsedRows.reduce((acc, r) => { const amt = Number(r.amount) || 0; if (r.type === 'Fuel') acc.fuel += amt; else acc.nonFuel += amt; return acc; }, { fuel: 0, nonFuel: 0 });
  const unresolvedUnparsedCount = preview ? preview.unparsed.length - Object.keys(manualUnparsed).length : 0;
  const combinedFuel = (preview?.totals.fuel || 0) + manualTotals.fuel;
  const combinedNonFuel = (preview?.totals.nonFuel || 0) + manualTotals.nonFuel;
  const combinedTotal = combinedFuel + combinedNonFuel;
  // "Total sin descuento" / "descuento" (pedido explícito): se saca sumando
  // el precio de lista y el ahorro de CADA fila leída del PDF — las filas
  // completadas a mano (sin precio de lista conocido) no tienen ahorro, así
  // que su retail = su monto, igual que hace commitStatementImportAction.
  const previewRetailTotal = (preview?.rows.reduce((s, r) => s + (r.retailPrice || r.amount), 0) || 0) + manualUnparsedRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const previewSavedTotal = preview?.rows.reduce((s, r) => s + r.saved, 0) || 0;
  const reconciled = Boolean(preview) && unresolvedUnparsedCount === 0
    && (preview!.declared.fuel === null || Math.abs(preview!.declared.fuel - combinedFuel) < 0.01)
    && (preview!.declared.nonFuel === null || Math.abs(preview!.declared.nonFuel - combinedNonFuel) < 0.01)
    && (preview!.declared.total === null || Math.abs(preview!.declared.total - combinedTotal) < 0.01)
    && (preview!.declared.saved === null || Math.abs(preview!.declared.saved - previewSavedTotal) < 0.01)
    && Math.abs((previewRetailTotal - previewSavedTotal) - combinedTotal) < 0.01;
  const statementWeekForImport = preview?.period ? fuelWeekStartOf(preview.period.start) : (preview?.rows[0]?.date ? fuelWeekStartOf(preview.rows[0].date) : weekStart);

  function openImport() { setError(''); setNotice(''); setImportError(''); setPreview(null); setImportOpen(true); requestAnimationFrame(() => document.getElementById('fuel-import')?.scrollIntoView({ block: 'start', behavior: 'instant' })); }
  async function handleParseStatement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (importBusy) return; const fields = new FormData(event.currentTarget);
    setImportBusy(true); setImportError('');
    try {
      const result = await parseMudflapStatementAction(fields);
      setPreview(result);
      // Todas seleccionadas por defecto, incluidas las marcadas como
      // "posible duplicado" (pedido explícito: si ya existen pero quedaron
      // en la semana equivocada, al confirmar se corrigen solas — nunca se
      // vuelve a crear una fila repetida, eso ya lo protege el servidor).
      setSelectedRows(new Set(result.rows.map((r, i) => i)));
      setRowDriverOverride({});
      setManualUnparsed({}); setOpenUnparsedIdx(null);
    } catch (e) { setImportError((e as Error).message); } finally { setImportBusy(false); }
  }
  async function confirmImport() {
    if (!preview || importBusy) return;
    setImportBusy(true); setImportError('');
    try {
      const fromPreview = preview.rows.map((r, i) => ({ r, i })).filter(({ i }) => selectedRows.has(i)).map(({ r, i }) => ({
        date: r.date, type: r.type, station: r.station, city: r.city, state: r.state,
        driverId: rowDriverOverride[i] ?? r.driverId, amount: r.amount, retailAmount: r.retailPrice, externalRef: r.externalRef,
        notes: `Importado de statement Mudflap${!(rowDriverOverride[i] ?? r.driverId) && r.driverNameRaw ? ` · Chofer en statement: ${r.driverNameRaw}` : ''}`,
      }));
      const fromManual = Object.values(manualUnparsed).map(r => ({
        date: r.date, type: r.type, station: r.station, city: r.city, state: r.state,
        driverId: r.driverId, amount: Number(r.amount) || 0, retailAmount: 0, externalRef: '',
        notes: 'Completada a mano: el PDF no se pudo leer automáticamente en esta fila (posible salto de página).',
      }));
      const input = [...fromPreview, ...fromManual];
      const result = await commitStatementImportAction(input, statementWeekForImport, state.revision);
      await fuel.refresh();
      setImportOpen(false); setPreview(null); setSelectedRows(new Set()); setManualUnparsed({}); setOpenUnparsedIdx(null);
      setNotice(`${t('¡Listo!')} ${result.imported} ${t('transacciones importadas correctamente.')}${result.reassigned ? ` ${result.reassigned} ${t('ya existían y se corrigieron a esta semana.')}` : ''}${result.skippedDuplicates ? ` ${result.skippedDuplicates} ${t('se omitieron por ya existir en la base de datos.')}` : ''}`);
    } catch (e) { setImportError((e as Error).message); } finally { setImportBusy(false); }
  }
  function toggleRow(i: number) { setSelectedRows(prev => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next; }); }

  return <div className={styles.fuel}>
    {fuel.error && <div role="alert" className={styles.error}>{fuel.error} <button onClick={() => void fuel.refresh()}>{t('Reintentar')}</button></div>}
    {!ready && !fuel.error && <p role="status">{t('Abriendo los registros de combustible…')}</p>}
    <div className={styles.weekBar}>
      <button onClick={() => setWeekStart(prevWeek)} aria-label={t('Semana anterior')}><ChevronLeft size={16}/></button>
      <span>📅 {weekLabel}</span>
      <button onClick={() => setWeekStart(nextWeek)} aria-label={t('Semana siguiente')}><ChevronRight size={16}/></button>
      <button onClick={() => setWeekStart(fuelWeekStartOf(today()))}>{t('Semana actual')}</button>
    </div>
    {/* Pedido explícito: los dos números del statement (sin/con descuento)
        y el resumen por grupo/chofer van SIEMPRE visibles arriba — nada de
        entrar a una pestaña aparte para verlos, porque esto es justo lo que
        ella copia y manda a Mario cada lunes en cuanto sube el statement. */}
    <div className={styles.statCards}>
      <div className={styles.statCard} data-tone="primary"><span className={styles.statIcon} aria-hidden="true"><FuelIcon size={16}/></span><strong>{ready ? money(weeklySummary.grandRetailTotal) : '—'}</strong><span className={styles.statLabel}>{t('Total sin descuentos')}</span></div>
      <div className={styles.statCard} data-tone="primary"><span className={styles.statIcon} aria-hidden="true"><FuelIcon size={16}/></span><strong>{ready ? money(weeklySummary.grandTotal) : '—'}</strong><span className={styles.statLabel}>{t('Total con descuentos')}</span></div>
    </div>
    {notice && <p role="status" className={styles.success}>{notice}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}

    <div className={styles.copyBox}>
      <div className={styles.copyBoxHead}>
        <h3 style={{ margin: 0 }}>{t('Resumen de Mudflap')}</h3>
        {weeklySummary.groups.length > 0 && <div className={styles.actions}>
          <button type="button" onClick={() => void copyResumen()}>
            {copied ? <Check size={15}/> : <Copy size={15}/>} {copied ? t('¡Copiado!') : t('Copiar resumen')}
          </button>
          <button type="button" onClick={downloadResumenPdf}><Printer size={15}/> {t('Descargar PDF')}</button>
        </div>}
      </div>
      {/* Cada chofer y cada grupo muestran su monto SIN descuento (pedido
          explícito, confirmado contra el resumen real que ella manda) — el
          descuento de Mudflap se aplica una sola vez, al final, nunca
          repartido entre choferes. */}
      {weeklySummary.groups.length ? weeklySummary.groups.map(g => <div key={g.group}>
        <p><strong>{t(groupLabel(g.group))}</strong></p>
        <ul style={{ listStyle: 'none', margin: '0 0 8px', padding: 0, display: 'grid', gap: 4 }}>
          {g.drivers.map(d => <li key={d.driverId} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span>{shortName(d.driverName)}</span><span>{money(d.retailAmount)}</span></li>)}
        </ul>
        {g.group && <p className={styles.tableSub} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><b>{t('Total')} {g.group}</b><b>{money(g.retailTotal)}</b></p>}
      </div>) : <p className={styles.empty}>{t('No hay transacciones de combustible en esta semana todavía.')}</p>}
      {weeklySummary.groups.length > 0 && <p style={{ display: 'flex', justifyContent: 'space-between', gap: 10, borderTop: '1px solid #e3dadd', paddingTop: 8, marginTop: 8 }}>
        <b>{t('Total sin descuentos')}</b><b>{money(weeklySummary.grandRetailTotal)}</b>
      </p>}
      {weeklySummary.groups.length > 0 && <p style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 0 }}>
        <b>{t('Total con descuentos')}</b><b>{money(weeklySummary.grandTotal)}</b>
      </p>}
    </div>

    <details>
      <summary>{t('Semanas anteriores')}</summary>
      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead><tr><th>{t('Semana')}</th><th>{t('Total con descuentos')}</th></tr></thead>
          <tbody>{weekHistory.map(h => <tr key={h.weekStart} className={`${styles.historyRow} ${h.weekStart === weekStart ? styles.rowActive : ''}`} onClick={() => setWeekStart(h.weekStart)}>
            <td>{weekPeriodLabel(h.weekStart)}{h.weekStart === fuelWeekStartOf(today()) ? ` · ${t('semana actual')}` : ''}</td>
            <td><strong>{money(h.total)}</strong></td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>

    <div className={styles.toolbarRow}>
      <button className={styles.primary} disabled={!ready} onClick={openImport}>{t('Importar PDF')}</button>
    </div>

    {importOpen && <div id="fuel-import" className={styles.form}>
      <h3>{t('Importar statement de Mudflap')}</h3>
      <p>{t('Sube el PDF semanal. Se leen las filas exactas del documento (sin adivinar montos); tú revisas y confirmas antes de guardar nada.')}</p>
      <form onSubmit={handleParseStatement} className={styles.fields}>
        <label className={styles.wide}>{t('Archivo PDF *')}<input name="statement" type="file" accept="application/pdf" required disabled={importBusy} /></label>
        <div className={styles.actions}><button type="submit" className={styles.primary} disabled={importBusy}>{importBusy ? t('Leyendo…') : t('Analizar PDF')}</button><button type="button" disabled={importBusy} onClick={() => { setImportOpen(false); setPreview(null); setImportError(''); }}>{t('Cancelar')}</button></div>
      </form>
      {importError && <p className={styles.error} role="alert">{importError}</p>}
      {preview && <>
        {preview.period && <p>{t('Período del statement:')} {dayLabel(preview.period.start)} – {dayLabel(preview.period.end)} · {t('se guardará en la semana de')} {weekPeriodLabel(statementWeekForImport)}</p>}
        <p>
          <b>{t('Filas leídas:')}</b> {preview.rows.length}{manualUnparsedRows.length > 0 ? ` + ${manualUnparsedRows.length} ${t('a mano')}` : ''} · <b>{t('Fuel:')}</b> {money(combinedFuel)}{preview.declared.fuel !== null && (Math.abs(preview.declared.fuel - combinedFuel) < 0.01 ? ` ✓ ${t('coincide con el PDF')}` : ` ⚠ ${t('el PDF declara')} ${money(preview.declared.fuel)}`)}
          {' · '}<b>{t('Non-Fuel:')}</b> {money(combinedNonFuel)}{preview.declared.nonFuel !== null && (Math.abs(preview.declared.nonFuel - combinedNonFuel) < 0.01 ? ` ✓ ${t('coincide con el PDF')}` : ` ⚠ ${t('el PDF declara')} ${money(preview.declared.nonFuel)}`)}
          {' · '}<b>{t('Total:')}</b> {money(combinedTotal)}{preview.declared.total !== null && (Math.abs(preview.declared.total - combinedTotal) < 0.01 ? ` ✓ ${t('coincide con el PDF')}` : ` ⚠ ${t('el PDF declara')} ${money(preview.declared.total)}`)}
        </p>
        <p>
          <b>{t('Sin descuento:')}</b> {money(previewRetailTotal)} · <b>{t('Descuento:')}</b> {money(previewSavedTotal)}{preview.declared.saved !== null && (Math.abs(preview.declared.saved - previewSavedTotal) < 0.01 ? ` ✓ ${t('coincide con el PDF')}` : ` ⚠ ${t('el PDF declara')} ${money(preview.declared.saved)}`)}
          {' · '}{money(previewRetailTotal)} − {money(previewSavedTotal)} = <b>{money(Math.round((previewRetailTotal - previewSavedTotal) * 100) / 100)}</b>
        </p>
        {preview.unparsed.length > 0 && <div className={styles.unparsedBox}>
          <p className={styles.error} role="alert">{unresolvedUnparsedCount > 0 ? `${unresolvedUnparsedCount} ${t('fila(s) no se pudieron leer automáticamente (posible salto de página en el PDF) — complétalas a mano abajo para poder importar.')}` : t('Todas las filas sin leer ya se completaron a mano — revisa los montos antes de confirmar.')}</p>
          {preview.unparsed.map((u, i) => {
            const resolved = manualUnparsed[i];
            return <div key={i} className={styles.unparsedRow}>
              <details><summary>{t('Ver texto sin procesar')}</summary><pre>{u.raw}</pre></details>
              {resolved ? <p className={styles.note}>✓ {t('Completada a mano:')} {dayLabel(resolved.date)} · {t(resolved.type)} · {resolved.station || t('Sin estación')} · {money(Number(resolved.amount) || 0)} <button type="button" onClick={() => setManualUnparsed(prev => { const next = { ...prev }; delete next[i]; return next; })}>{t('Quitar')}</button></p>
                : openUnparsedIdx === i ? <form className={styles.fields} onSubmit={e => {
                    e.preventDefault(); const f = new FormData(e.currentTarget);
                    const row: ManualUnparsedRow = { date: String(f.get('date') || ''), type: String(f.get('type') || 'Fuel') as 'Fuel' | 'Non-Fuel', station: String(f.get('station') || ''), city: String(f.get('city') || ''), state: String(f.get('state') || ''), driverId: String(f.get('driverId') || ''), amount: String(f.get('amount') || '') };
                    setManualUnparsed(prev => ({ ...prev, [i]: row })); setOpenUnparsedIdx(null);
                  }}>
                    <label>{t('Fecha *')}<input name="date" type="date" required /></label>
                    <label>{t('Tipo *')}<select name="type" defaultValue="Fuel"><option value="Fuel">{t('Fuel')}</option><option value="Non-Fuel">{t('Non-Fuel')}</option></select></label>
                    <label>{t('Estación')}<input name="station" maxLength={150} /></label>
                    <label>{t('Ciudad')}<input name="city" maxLength={100} /></label>
                    <label>{t('Estado')}<input name="state" maxLength={50} /></label>
                    <label>{t('Chofer')}<select name="driverId" defaultValue=""><option value="">{t('Sin asignar')}</option>{fleet.state.drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
                    <label>{t('Monto *')}<input name="amount" type="number" step="0.01" min="0" required /></label>
                    <div className={styles.actions}><button type="submit" className={styles.primary}>{t('Guardar fila')}</button><button type="button" onClick={() => setOpenUnparsedIdx(null)}>{t('Cancelar')}</button></div>
                  </form>
                : <button type="button" onClick={() => setOpenUnparsedIdx(i)}>{t('Completar esta fila a mano')}</button>}
            </div>;
          })}
        </div>}
        {preview.rows.some(r => r.duplicate) && <p className={styles.note}>{preview.rows.filter(r => r.duplicate).length} {t('de')} {preview.rows.length} {t('filas ya existían en el sistema (marcadas como "posible duplicado"). No hay problema en dejarlas seleccionadas: al confirmar, el sistema nunca las duplica — si ya estaban en esta semana no pasa nada, y si habían quedado en otra semana (por ejemplo, cargadas antes de este arreglo) se corrigen solas.')}</p>}
        {!reconciled && <p className={styles.error} role="alert">{t('No se puede importar todavía: los totales no coinciden exactamente con lo que declara el PDF, o hay filas sin leer. Resuelve eso primero.')}</p>}
        <div className={styles.importTableWrap}>
          <table className={styles.importTable}>
            <thead><tr><th></th><th>{t('Fecha')}</th><th>{t('Tipo')}</th><th>{t('Estación')}</th><th>{t('Ciudad')}</th><th>{t('Chofer')}</th><th>{t('Monto')}</th></tr></thead>
            <tbody>{preview.rows.map((r, i) => <tr key={i} className={r.duplicate ? styles.duplicateRow : ''}>
              <td><input type="checkbox" checked={selectedRows.has(i)} onChange={() => toggleRow(i)} aria-label={t('Incluir fila')} /></td>
              <td>{dayLabel(r.date)}</td>
              <td>{t(r.type)}</td>
              <td>{r.station}</td>
              <td>{r.city}{r.city && r.state ? ', ' : ''}{r.state}</td>
              <td><select value={rowDriverOverride[i] ?? r.driverId} onChange={e => setRowDriverOverride(prev => ({ ...prev, [i]: e.target.value }))}><option value="">{r.driverNameRaw ? `${t('Sin asignar')} (${r.driverNameRaw})` : t('Sin asignar')}</option>{fleet.state.drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></td>
              <td>{money(r.amount)}{r.duplicate ? ` · ${t('posible duplicado')}` : ''}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className={styles.actions}><button className={styles.primary} disabled={importBusy || (!selectedRows.size && !manualUnparsedRows.length) || !reconciled} onClick={confirmImport}>{importBusy ? t('Importando…') : `${t('Confirmar e importar')} (${selectedRows.size + manualUnparsedRows.length})`}</button><button type="button" disabled={importBusy} onClick={() => { setImportOpen(false); setPreview(null); setManualUnparsed({}); setOpenUnparsedIdx(null); }}>{t('Cancelar')}</button></div>
      </>}
    </div>}

    <div className={styles.summaryGrid}>
      <section className={styles.summaryPanel}>
        <h3>{t('Top 3 Choferes (Combustible)')}</h3>
        {topDrivers.length ? <ol>{topDrivers.map(([driverId, amount], i) => <li key={driverId}>{i + 1}. {driverName(driverId) || t('Sin chofer')} <b>{money(amount)}</b></li>)}</ol> : <p className={styles.empty}>{t('Sin datos en este rango.')}</p>}
      </section>
    </div>
  </div>;
}
