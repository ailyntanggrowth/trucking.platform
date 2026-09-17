"use client";
import { useRef, useState, type FormEvent } from 'react';
import {
  computeMarioSettlements, dispatcherCommissionDetail, invoiceNumberFor,
  weekStartOf, weekRange, isWeekLocked, fuelWeekStartOf, type SettlementConfig,
} from '../lib/settlements';
import { isOfficial, type Load } from '../lib/loads';
import { computeWeeklyFuelSummary } from '../lib/fuel';
import type { SettlementsController } from '../lib/use-settlements';
import type { LoadsController } from '../lib/use-loads';
import type { FleetController } from '../lib/use-fleet';
import type { FuelController } from '../lib/use-fuel';
import { money, dayLabel, today } from '../lib/format';
import type { Lang } from '../lib/i18n';
import { Truck, Fuel as FuelIcon, Users, TrendingUp, ChevronLeft, ChevronRight, Settings, X, ShieldCheck, Lock, MoreVertical, Trash2, Printer, Wrench } from 'lucide-react';
import styles from './settlements.module.css';

// Tabla semanal por chofer (pedido explícito): es exactamente la que la
// dueña mandaba a mano cada lunes a Mario, movida aquí desde Cargas ("Ver
// resumen semanal") para que quede junto con los 4 números de abajo — un
// solo resumen, una sola captura. Una carga entra en la semana según su
// FECHA DE ENTREGA (no la de recogida ni la de pago) — regla ya existente,
// sin cambios, solo de lugar.
const FLEET_GROUPS = ['Mario', 'Owner Operators', 'Lázaro'] as const;
const WEEKDAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function entregaLabel(l: Load) {
  const pDay = l.pickupDate ? Number(l.pickupDate.slice(8, 10)) : null;
  const dDay = l.deliveryDate ? Number(l.deliveryDate.slice(8, 10)) : null;
  const weekday = l.deliveryDate ? WEEKDAYS_ES[new Date(`${l.deliveryDate}T12:00:00Z`).getUTCDay()].toUpperCase() : '';
  return pDay != null && dDay != null ? `${pDay}-${dDay} ${weekday}` : weekday;
}

// REDISEÑO (pedido explícito de la dueña): Contabilidad y Pagos ahora tiene
// SOLO "Esta semana" (los 4 números + Salarios pagados a mano) — sin
// duplicar nada de lo que ya se ve en Recorrido de cada chofer (Cargas, que
// ya tiene su propia lista de cargas por chofer con "Marcar pagada") ni en
// Reportes (grupos Owner Operators/Lázaro). "Pagos a Choferes" (la lista
// Pendientes/Pagados) se quitó por completo de aquí por ese motivo — el
// cálculo de Salarios sigue usando los mismos marks, solo que ya no hay una
// segunda pantalla para tocarlos. Las 4 funciones que no entran en ese
// diseño simple (comisión del despachador/Gleybis, seguro semanal,
// configuración de %/tramos, cerrar-reabrir invoice) siguen detrás del
// botón "⚙️ Más opciones".
type MoreTab = 'dispatcher' | 'insurance' | 'config' | 'lock';
const AVATAR_TONES = ['#8B102A', '#1e4e8c', '#8a5a00', '#1f7a4d', '#6b3fa0', '#a12b2b'];
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?';
function Avatar({ name, index }: { name: string; index: number }) {
  return <span className={styles.avatar} style={{ background: AVATAR_TONES[index % AVATAR_TONES.length] }}>{initials(name)}</span>;
}

export default function SettlementsModule({ settlements, loads, fuel, fleet, lang, t }: {
  settlements: SettlementsController; loads: LoadsController; fuel: FuelController; fleet: FleetController; lang: Lang; t: (es: string) => string;
}) {
  const { state, ready } = settlements;
  const [weekStart, setWeekStart] = useState(weekStartOf(today()));
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false), [moreTab, setMoreTab] = useState<MoreTab>('dispatcher');
  const [salariosOpen, setSalariosOpen] = useState(false);
  const [roturasOpen, setRoturasOpen] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  // Pedido explícito: la imagen (html2canvas) salía cortada/fea en el
  // celular. Se cambió al mismo patrón que Combustible y Mi Invoice — el
  // diálogo de impresión nativo del navegador, donde ella elige "Guardar
  // como PDF" y ya queda un documento completo, sin recortes, listo para
  // mandar por WhatsApp o correo.
  function downloadSummaryPdf() {
    const prevTitle = document.title;
    document.title = `Resumen semanal - ${weekLabel}`;
    window.print();
    document.title = prevTitle;
  }

  const ready2 = ready && loads.ready && fuel.ready && fleet.ready;
  const { end: weekEnd, prevWeek, nextWeek } = weekRange(weekStart);
  const weekLabel = `${new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(`${weekStart}T12:00:00Z`))} – ${new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(new Date(`${weekEnd}T12:00:00Z`).getTime() - 86400000))}`;
  const locked = isWeekLocked(weekEnd, state.weekLocks);
  const weekLock = state.weekLocks.find(w => w.weekEnd === weekEnd);
  const summaryGroups = FLEET_GROUPS.map(g => ({
    group: g,
    rows: loads.state.loads
      .filter(l => fleet.state.drivers.find(d => d.id === l.driverId)?.group === g && isOfficial(l) && l.status !== 'Cancelada' && l.status !== 'Reemplazada' && l.deliveryDate >= weekStart && l.deliveryDate < weekEnd)
      .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate)),
  }));

  const mario = computeMarioSettlements(fleet.state.drivers, loads.state.loads, fuel.state.transactions, fuel.state.expenses, weekStart, weekEnd, state.config, state.driverInsurance, state.marks, weekStart, weekEnd);
  const dispatcher = dispatcherCommissionDetail(fleet.state.drivers, loads.state.loads, weekStart, weekEnd, state.config, state.weekLocks);
  const invoiceNumber = invoiceNumberFor(weekStart);
  const dispatcherMark = state.dispatcherMarks.find(m => m.weekStart === weekStart);
  const dispatcherPaid = dispatcherMark?.paymentStatus === 'Pagada';
  // Regla fija (pedido explícito, aclarado en conversación): el invoice del
  // despachador de la semana N se arma con las cargas de esa semana y cierra
  // el lunes de esa semana — pero a Gleiby se le PAGA en los días siguientes,
  // ya dentro de la semana N+1. Por eso, para "Salarios", lo que importa no
  // es si el invoice de ESTA semana ya está pagado (todavía ni cierra), sino
  // si el invoice de la semana ANTERIOR (la que sí cerró) ya se pagó — ese
  // pago es el que realmente sale de la caja durante la semana que se está
  // mirando.
  const priorDispatcher = dispatcherCommissionDetail(fleet.state.drivers, loads.state.loads, prevWeek, weekStart, state.config, state.weekLocks);
  const priorDispatcherMark = state.dispatcherMarks.find(m => m.weekStart === prevWeek);
  const priorDispatcherPaid = priorDispatcherMark?.paymentStatus === 'Pagada';

  // Los 4 números de "Esta semana" — siempre calculados en vivo desde lo que
  // ya existe en Cargas/Combustible/Recorrido de cada chofer, nunca captura
  // manual (pedido explícito): así una corrección posterior (ej. Summar) se
  // refleja sola sin tener que "actualizar" nada aquí.
  // "Cargas realizadas" (CORREGIDO, pedido explícito): antes sumaba por fecha
  // de PAGO, lo que mezclaba en una sola semana cargas de semanas pasadas que
  // Summar terminó pagando de golpe el mismo día (caso real: $117,555 en la
  // tarjeta vs. $64,657 sumando a mano las 17 cargas que de verdad se veían
  // en la tabla de abajo, semana del 8 al 14 de septiembre). Ahora se saca
  // directo de `summaryGroups` — las MISMAS cargas que se ven en la tabla,
  // por fecha de ENTREGA dentro de la semana elegida — para que la tarjeta y
  // la tabla nunca puedan des-cuadrarse entre sí ni sumar una carga dos veces.
  // Corregido otra vez (pedido explícito): "ganancias" acá es SOLO el grupo
  // Mario — igual que Combustible Mario y Salarios (ambos ya son solo de
  // Mario), nunca Owner Operators ni Lázaro, que tienen su propio arreglo de
  // pago aparte. La tabla de abajo sigue mostrando los 3 grupos (es la misma
  // que se le manda a Mario cada lunes), solo esta tarjeta —y por lo tanto
  // "Dinero que queda"— se limita a Mario.
  const cargasRealizadas = summaryGroups.find(g => g.group === 'Mario')?.rows.reduce((s, l) => s + l.amount, 0) ?? 0;
  // "Combustible" (pedido explícito): solo el total del grupo Mario que
  // salió en el statement de Mudflap — ya no todos los grupos ni gastos
  // reales (peajes, etc.). Usa la semana del STATEMENT (lunes a domingo),
  // no la de Cargas (martes a lunes) — se toma la que contiene el martes
  // de esta semana, que es la misma que ella mira en Combustible.
  const mudflapWeekStart = fuelWeekStartOf(weekStart);
  const combustibleMario = computeWeeklyFuelSummary(fuel.state, fleet.state.drivers, mudflapWeekStart).groups.find(g => g.group === 'Mario')?.retailTotal || 0;
  // "Salarios" (pedido explícito, antes "Pago a choferes") usa el monto REAL
  // que Mario pagó (amountPaid), no el estimado por tramos (driverPay) — para
  // que coincida con lo que de verdad salió de la caja. Se le suma lo
  // registrado a mano en "Salarios pagados a mano" (viajes que el sistema
  // todavía no puede calcular solo, p.ej. uno que sigue abierto desde hace
  // semanas sin cerrar en Cargas) y, si ya se pagó, el invoice del
  // despachador (Gleiby) DE LA SEMANA ANTERIOR — también es un salario de
  // ella, y es el que realmente se paga durante esta semana (ver nota
  // arriba sobre priorDispatcher).
  const weekManualSalaries = state.manualSalaries.filter(m => m.weekStart === weekStart);
  const manualSalariesTotal = weekManualSalaries.reduce((s, m) => s + m.amount, 0);
  const pagoAChoferes = mario.filter(m => m.paymentStatus === 'Pagada').reduce((s, m) => s + m.amountPaid, 0) + manualSalariesTotal + (priorDispatcherPaid ? priorDispatcher.commission : 0);
  // "Roturas" (pedido explícito): costo real de reparaciones anotado a mano
  // — el reporte de rotura de una carga (Cargas → incidentCost) es solo una
  // nota informativa que se pierde al resolverse, nunca se restaba de nada.
  const weekManualRepairs = state.manualRepairs.filter(m => m.weekStart === weekStart);
  const roturas = weekManualRepairs.reduce((s, m) => s + m.amount, 0);
  const dineroQueQueda = cargasRealizadas - combustibleMario - pagoAChoferes - roturas;
  const driverNameFor = (id: string) => fleet.state.drivers.find(d => d.id === id)?.name || t('Chofer eliminado');

  async function addManualSalary(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; const fields = new FormData(event.currentTarget);
    const driverId = String(fields.get('driverId') || ''); const payeeName = String(fields.get('payeeName') || '').trim(); const amount = Number(fields.get('amount') || 0); const notes = String(fields.get('notes') || '');
    setError(''); setNotice(''); setBusy(true);
    try {
      const next = await settlements.commit({ type: 'manualSalary', record: { id: crypto.randomUUID(), weekStart, driverId: payeeName ? '' : driverId, payeeName, amount, notes } });
      setNotice(next.events[0].detail);
      (event.target as HTMLFormElement).reset();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function removeManualSalary(id: string) {
    if (busy) return; setError(''); setNotice(''); setBusy(true);
    try { const next = await settlements.commit({ type: 'deleteManualSalary', id }); setNotice(next.events[0].detail); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function addManualRepair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; const fields = new FormData(event.currentTarget);
    const driverId = String(fields.get('driverId') || ''); const description = String(fields.get('description') || '').trim(); const amount = Number(fields.get('amount') || 0); const notes = String(fields.get('notes') || '');
    setError(''); setNotice(''); setBusy(true);
    try {
      const next = await settlements.commit({ type: 'manualRepair', record: { id: crypto.randomUUID(), weekStart, driverId, description, amount, notes } });
      setNotice(next.events[0].detail);
      (event.target as HTMLFormElement).reset();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function removeManualRepair(id: string) {
    if (busy) return; setError(''); setNotice(''); setBusy(true);
    try { const next = await settlements.commit({ type: 'deleteManualRepair', id }); setNotice(next.events[0].detail); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function toggleDispatcherMark(current: 'Pendiente' | 'Pagada') {
    if (busy) return; setError(''); setNotice(''); setBusy(true);
    try {
      const next = await settlements.commit({ type: 'dispatcherMark', weekStart, paymentStatus: current === 'Pagada' ? 'Pendiente' : 'Pagada', notes: '' });
      setNotice(next.events[0].detail);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function saveInsurance(driverId: string, amount: number) {
    if (busy || locked) return; setError(''); setNotice(''); setBusy(true);
    try { const next = await settlements.commit({ type: 'insurance', driverId, amount }); setNotice(next.events[0].detail); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function closeWeek() {
    if (busy || locked) return; setError(''); setNotice(''); setBusy(true);
    try { const next = await settlements.commit({ type: 'closeWeek', weekEnd }); setNotice(next.events[0].detail); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function reopenWeek() {
    if (busy || !locked) return; setError(''); setNotice(''); setBusy(true);
    try { const next = await settlements.commit({ type: 'reopenWeek', weekEnd }); setNotice(next.events[0].detail); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function saveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; const fields = new FormData(event.currentTarget);
    const num = (key: string) => Number(fields.get(key) || 0);
    const config: SettlementConfig = {
      companyDeductionPct: num('companyDeductionPct') / 100, dispatcherCommissionPct: num('dispatcherCommissionPct') / 100,
      tier1Max: num('tier1Max'), tier1Pay: num('tier1Pay'), tier2Max: num('tier2Max'), tier2Pay: num('tier2Pay'), tier3Pay: num('tier3Pay'),
      ownerOperatorCutPct: num('ownerOperatorCutPct') / 100,
    };
    setError(''); setNotice(''); setBusy(true);
    try { const next = await settlements.commit({ type: 'config', config }); setNotice(next.events[0].detail); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function openMore(tab: MoreTab) { setError(''); setNotice(''); setMoreTab(tab); setMoreOpen(true); }

  return <div className={styles.settlements}>
    {(settlements.error || loads.error || fuel.error || fleet.error) && <div role="alert" className={styles.error}>{settlements.error || loads.error || fuel.error || fleet.error}</div>}
    {!ready2 && <p role="status">{t('Abriendo los registros de contabilidad…')}</p>}

    <div className={styles.weekBar}>
      <button onClick={() => setWeekStart(prevWeek)} aria-label={t('Semana anterior')}><ChevronLeft size={16} /></button>
      <span>📅 {t('Semana')} {weekLabel}</span>
      <button onClick={() => setWeekStart(nextWeek)} aria-label={t('Semana siguiente')}><ChevronRight size={16} /></button>
      <button onClick={() => setWeekStart(weekStartOf(today()))}>{t('Semana actual')}</button>
      <button onClick={() => openMore('dispatcher')}><Settings size={15} /> {t('Más opciones')}</button>
      <button onClick={downloadSummaryPdf}><Printer size={15} /> {t('Descargar PDF')}</button>
    </div>
    {locked && weekLock && <p className={styles.note}>{t('Semana cerrada el')} {new Date(weekLock.lockedAt).toLocaleString('es')} — {t('los montos son finales y no se pueden editar.')}</p>}

    {notice && <p role="status" className={styles.success}>{notice}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}

    {/* Todo lo de aquí adentro es lo que se descarga como una sola imagen
        (pedido explícito): la tabla de cargas por chofer que ella le manda a
        Mario cada lunes, justo arriba de los 4 números — un solo resumen. */}
    <div ref={summaryRef} className={styles.summaryCapture}>
      <p className={styles.captureWeekLabel}>{weekLabel}</p>
      {summaryGroups.map(g => g.rows.length > 0 && <div key={g.group}>
        <div className={styles.summaryGroupHeader}>{g.group === 'Mario' ? t('MARIO') : g.group === 'Owner Operators' ? t('OWNER OPERATORS') : t('CARGAS DE LAZARO')}</div>
        <table className={styles.summaryTable}>
          <colgroup><col style={{ width: '19%' }} /><col style={{ width: '15%' }} /><col style={{ width: '16%' }} /><col style={{ width: '13%' }} /><col style={{ width: '20%' }} /><col style={{ width: '13%' }} /></colgroup>
          <thead><tr><th>{t('CHOFER')}</th><th>{t('CARGA')}</th><th>{t('PRECIO')}</th><th>{t('RUTA')}</th><th>{t('FECHAS')}</th><th>{t('SUM.')}</th></tr></thead>
          <tbody>{g.rows.map(l => <tr key={l.id}>
            <td>{driverNameFor(l.driverId)}</td>
            <td>{l.loadNumber || '—'}</td>
            <td>{money(l.amount)}</td>
            <td>{l.pickupState}-{l.deliveryState}</td>
            <td>{entregaLabel(l)}</td>
            <td>{l.paymentStatus === 'Pagada' ? 'LIST' : ''}</td>
          </tr>)}</tbody>
        </table>
      </div>)}
      {ready && !summaryGroups.some(g => g.rows.length) && <p className={styles.empty}>{t('No hay cargas con entrega esta semana.')}</p>}

      <h2>{t('Esta semana')}</h2>
      <div className={styles.statCards}>
        <div className={styles.statCard} data-tone="blue"><span className={styles.statIcon} aria-hidden="true"><Truck size={16} /></span><span className={styles.statLabel}>{t('Cargas realizadas')}</span><strong>{ready2 ? money(cargasRealizadas) : '—'}</strong></div>
        <div className={styles.statCard} data-tone="amber"><span className={styles.statIcon} aria-hidden="true"><FuelIcon size={16} /></span><span className={styles.statLabel}>{t('Combustible Mario (Mudflap)')}</span><strong>{ready2 ? money(combustibleMario) : '—'}</strong></div>
        <div className={styles.statCard} data-tone="red">
          <span className={styles.statIcon} aria-hidden="true"><Users size={16} /></span><span className={styles.statLabel}>{t('Salarios')}</span><strong>{ready2 ? money(pagoAChoferes) : '—'}</strong>
        </div>
        <div className={styles.statCard} data-tone="red">
          <span className={styles.statIcon} aria-hidden="true"><Wrench size={16} /></span><span className={styles.statLabel}>{t('Roturas')}</span><strong>{ready2 ? money(roturas) : '—'}</strong>
        </div>
      </div>

      <div className={styles.moneyCard}>
        <span className={styles.statIcon} aria-hidden="true"><TrendingUp size={18} /></span>
        <span className={styles.statLabel}>{t('Dinero que queda')}</span>
        <strong>{ready2 ? money(dineroQueQueda) : '—'}</strong>
      </div>
    </div>

    <button type="button" className={styles.textButton} onClick={() => setSalariosOpen(o => !o)}><MoreVertical size={15} /> {t('Editar salarios pagados a mano')}</button>
    {salariosOpen && <div className={styles.rowDetail}>
      <h3>{t('Salarios pagados a mano')}</h3>
      <p className={styles.note}>{t('Para pagos que el sistema todavía no puede calcular solo — por ejemplo, un viaje que sigue abierto desde hace semanas. Se suman al número de "Salarios" de arriba.')}</p>
      {weekManualSalaries.length > 0 && <ul className={styles.plainList}>
        {weekManualSalaries.map(m => <li key={m.id}>
          <span>{m.driverId ? driverNameFor(m.driverId) : m.payeeName}{m.notes ? ` · ${m.notes}` : ''}</span>
          <span className={styles.actions}><b>{money(m.amount)}</b><button disabled={busy} onClick={() => removeManualSalary(m.id)} aria-label={t('Quitar')}><Trash2 size={15} /></button></span>
        </li>)}
      </ul>}
      <form className={styles.fields} onSubmit={addManualSalary}>
        <label>{t('Chofer')}<select name="driverId" defaultValue=""><option value="">{t('— Ninguno (usar el nombre de abajo) —')}</option>{fleet.state.drivers.filter(d => d.active).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>{t('O nombre (si no es un chofer)')}<input name="payeeName" maxLength={100} placeholder={t('Ej. Ailyn')} /></label>
        <label>{t('Monto *')}<input name="amount" type="number" min="0.01" step="0.01" required /></label>
        <label className={styles.wide}>{t('Nota')}<input name="notes" maxLength={300} placeholder={t('Ej. adelanto del viaje que sigue abierto')} /></label>
        <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{t('+ Agregar salario')}</button></div>
      </form>
    </div>}

    <button type="button" className={styles.textButton} onClick={() => setRoturasOpen(o => !o)}><Wrench size={15} /> {t('Editar roturas')}</button>
    {roturasOpen && <div className={styles.rowDetail}>
      <h3>{t('Roturas')}</h3>
      <p className={styles.note}>{t('El costo de una reparación (ej. cuando se reporta y luego se quita una rotura en Cargas) — anótalo aquí para que sí se reste del "Dinero que queda" de arriba.')}</p>
      {weekManualRepairs.length > 0 && <ul className={styles.plainList}>
        {weekManualRepairs.map(m => <li key={m.id}>
          <span>{m.description}{m.driverId ? ` · ${driverNameFor(m.driverId)}` : ''}{m.notes ? ` · ${m.notes}` : ''}</span>
          <span className={styles.actions}><b>{money(m.amount)}</b><button disabled={busy} onClick={() => removeManualRepair(m.id)} aria-label={t('Quitar')}><Trash2 size={15} /></button></span>
        </li>)}
      </ul>}
      <form className={styles.fields} onSubmit={addManualRepair}>
        <label className={styles.wide}>{t('¿Qué se reparó? *')}<input name="description" maxLength={200} required placeholder={t('Ej. se ponchó una llanta, se rompió el motor…')} /></label>
        <label>{t('Chofer (opcional)')}<select name="driverId" defaultValue=""><option value="">{t('— Ninguno —')}</option>{fleet.state.drivers.filter(d => d.active).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>{t('Costo *')}<input name="amount" type="number" min="0.01" step="0.01" required /></label>
        <label className={styles.wide}>{t('Nota')}<input name="notes" maxLength={300} placeholder={t('Ej. carga de Agner #38329284')} /></label>
        <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{t('+ Agregar rotura')}</button></div>
      </form>
    </div>}


    {moreOpen && <div className={styles.moreOverlay} role="dialog" aria-label={t('Más opciones')}>
      <div className={styles.morePanel}>
        <div className={styles.morePanelHeader}>
          <strong>{t('Más opciones')}</strong>
          <button onClick={() => setMoreOpen(false)} aria-label={t('Cerrar')}><X size={20} /></button>
        </div>
        <nav className={styles.tabs} aria-label={t('Secciones de más opciones')}>
          <button aria-pressed={moreTab === 'dispatcher'} onClick={() => setMoreTab('dispatcher')}>{t('Dispatcher')} <span className={styles.count}>#{invoiceNumber}</span></button>
          <button aria-pressed={moreTab === 'insurance'} onClick={() => setMoreTab('insurance')}><ShieldCheck size={14} /> {t('Seguro')}</button>
          <button aria-pressed={moreTab === 'config'} onClick={() => setMoreTab('config')}><Settings size={14} /> {t('Configuración')}</button>
          <button aria-pressed={moreTab === 'lock'} onClick={() => setMoreTab('lock')}><Lock size={14} /> {t('Cerrar semana')}</button>
        </nav>

        {moreTab === 'dispatcher' && <>
          <div className={styles.rowDetail}>
            <h3>{t('Invoice')} #{invoiceNumber} — {t('comisión de Gleybis')}</h3>
            <p><b>{t('Bruto:')}</b> {money(dispatcher.gross)} · <b>{t('Comisión (4%):')}</b> {money(dispatcher.commission)}</p>
            <div className={styles.actions}>
              <span className={`${styles.badge} ${dispatcherPaid ? styles.badgePaid : styles.badgePending}`}>{dispatcherPaid ? t('Pagada') : t('Pendiente')}</span>
              <button disabled={busy} onClick={() => toggleDispatcherMark(dispatcherMark?.paymentStatus || 'Pendiente')}>{dispatcherPaid ? t('Marcar pendiente') : t('Marcar pagada')}</button>
            </div>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.dataTable}>
              <thead><tr><th>{t('Carga')}</th><th>{t('Chofer')}</th><th>{t('Grupo')}</th><th>{t('Bruto')}</th><th>{t('Comisión')}</th></tr></thead>
              <tbody>{dispatcher.rows.map(r => <tr key={r.loadId}>
                <td>{r.loadNumber || t('Sin número')}</td>
                <td>{r.driverName}</td>
                <td className={styles.tableSub}>{r.group}</td>
                <td className={styles.tableSub}>{money(r.amount)}</td>
                <td><strong>{money(r.commission)}</strong></td>
              </tr>)}</tbody>
            </table>
            {ready2 && !dispatcher.rows.length && <p className={styles.empty}>{t('No hay cargas pagadas en este invoice todavía.')}</p>}
          </div>
        </>}

        {moreTab === 'insurance' && <div className={styles.tableWrap}>
          <table className={styles.dataTable}>
            <thead><tr><th>{t('Chofer')}</th><th>{t('Seguro semanal')}</th><th aria-hidden="true"></th></tr></thead>
            <tbody>{mario.map((m, i) => <tr key={m.driverId}>
              <td><span className={styles.who}><Avatar name={m.driverName} index={i} />{m.driverName}</span></td>
              <td colSpan={2}>
                <form className={styles.insuranceForm} onSubmit={e => { e.preventDefault(); const v = Number(new FormData(e.currentTarget).get('insurance') || 0); void saveInsurance(m.driverId, v); }}>
                  <input name="insurance" type="number" min="0" step="0.01" defaultValue={m.insurance} disabled={locked} />
                  <button type="submit" disabled={busy || locked}>{t('Guardar')}</button>
                </form>
              </td>
            </tr>)}</tbody>
          </table>
          {ready2 && !mario.length && <p className={styles.empty}>{t('No hay choferes del grupo Mario todavía.')}</p>}
        </div>}

        {moreTab === 'config' && <form className={styles.form} onSubmit={saveConfig}>
          <h3>{t('Configuración de Contabilidad y Pagos')}</h3>
          <p className={styles.note}>{t('Estos valores son del ejemplo de la compañía actual, no reglas universales — ajústalos si cambian.')}</p>
          <div className={styles.fields}>
            <label>{t('Descuento de compañía (%)')}<input name="companyDeductionPct" type="number" min="0" max="100" step="0.1" defaultValue={state.config.companyDeductionPct * 100} /></label>
            <label>{t('Comisión del despachador (%)')}<input name="dispatcherCommissionPct" type="number" min="0" max="100" step="0.1" defaultValue={state.config.dispatcherCommissionPct * 100} /></label>
            <label>{t('Corte de Owner Operators (%)')}<input name="ownerOperatorCutPct" type="number" min="0" max="100" step="0.1" defaultValue={state.config.ownerOperatorCutPct * 100} /></label>
            <label>{t('Tramo 1 — bruto hasta')}<input name="tier1Max" type="number" min="0" step="1" defaultValue={state.config.tier1Max} /></label>
            <label>{t('Tramo 1 — pago')}<input name="tier1Pay" type="number" min="0" step="1" defaultValue={state.config.tier1Pay} /></label>
            <label>{t('Tramo 2 — bruto hasta')}<input name="tier2Max" type="number" min="0" step="1" defaultValue={state.config.tier2Max} /></label>
            <label>{t('Tramo 2 — pago')}<input name="tier2Pay" type="number" min="0" step="1" defaultValue={state.config.tier2Pay} /></label>
            <label>{t('Tramo 3 — pago (arriba del tramo 2)')}<input name="tier3Pay" type="number" min="0" step="1" defaultValue={state.config.tier3Pay} /></label>
          </div>
          <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{busy ? t('Guardando…') : t('Guardar configuración')}</button></div>
        </form>}

        {moreTab === 'lock' && <div className={styles.rowDetail}>
          <h3>{t('Invoice de la semana')} {weekLabel}</h3>
          {locked && weekLock
            ? <p>{t('Esta semana está cerrada desde el')} {new Date(weekLock.lockedAt).toLocaleString('es')}. {t('Los montos son finales y no se pueden editar.')}</p>
            : <p>{t('Esta semana sigue abierta: los montos se pueden seguir marcando/editando. Ciérrala cuando quieras, no hay hora automática.')}</p>}
          <div className={styles.actions}>
            {locked
              ? <button disabled={busy} onClick={reopenWeek}>{t('Reabrir semana')}</button>
              : <button className={styles.primary} disabled={busy} onClick={closeWeek}>{t('Cerrar invoice de esta semana')}</button>}
          </div>
        </div>}
      </div>
    </div>}
  </div>;
}
