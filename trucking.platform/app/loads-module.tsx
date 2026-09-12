"use client";
import { useRef, useState, type FormEvent } from 'react';
import { LOAD_STATUS_VALUES, PAYMENT_STATUS_VALUES, isOfficial, computeDriverTrips, type Load, type LoadAction, type LoadStatus, type PaymentStatus } from '../lib/loads';
import { parseSummarStatementAction, commitSummarBatchAction, type SummarStatementPreview } from '../lib/summar-actions';
import { driverPayForGross, weekStartOf, weekRange } from '../lib/settlements';
import type { LoadsController } from '../lib/use-loads';
import type { FleetController } from '../lib/use-fleet';
import type { SettlementsController } from '../lib/use-settlements';
import { money, dayLabel, today } from '../lib/format';
import type { Lang } from '../lib/i18n';
import styles from './loads.module.css';

type Editor = { type: 'load' | 'cancel' | 'replace' | 'incident'; id: string; revision: number };
const FLEET_GROUPS = ['Mario', 'Owner Operators', 'Lázaro'] as const;

export default function LoadsModule({ loads, fleet, settlements, canEdit, lang, t, initialFilter }: { loads: LoadsController; fleet: FleetController; settlements: SettlementsController; canEdit: boolean; lang: Lang; t: (es: string) => string; initialFilter?: string }) {
  const { state, ready } = loads;
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  // Pago real del chofer de Mario por viaje (pedido explícito): puede ser
  // distinto al salario estimado por tramos — se anota aquí mismo, en el
  // recorrido, en vez de en Contabilidad, porque el período es el viaje
  // (desde que sale de FL), no la semana fija del negocio.
  const [payTrip, setPayTrip] = useState<{ driverId: string; driverName: string; tripStart: string } | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payBusy, setPayBusy] = useState(false), [payError, setPayError] = useState('');
  const driverName = (id: string) => fleet.state.drivers.find(d => d.id === id)?.name || '';

  // Subir Summar (pedido explícito): lee el PDF del "Purchase Summary Report"
  // y propone marcar como pagadas las cargas que encuentra — ella revisa y
  // confirma, nunca se aplica solo. Ver lib/summar.ts y parseSummarStatementAction.
  const [summarOpen, setSummarOpen] = useState(false), [summarBusy, setSummarBusy] = useState(false), [summarError, setSummarError] = useState('');
  const [summarPreview, setSummarPreview] = useState<SummarStatementPreview | null>(null);
  const [summarSelected, setSummarSelected] = useState<Set<string>>(new Set());
  function openSummar() { setError(''); setNotice(''); setEditor(null); setSummarError(''); setSummarPreview(null); setSummarOpen(true); requestAnimationFrame(() => document.getElementById('summar-import')?.scrollIntoView({ block: 'start', behavior: 'instant' })); }
  async function submitSummar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (summarBusy) return;
    const fields = new FormData(event.currentTarget);
    setSummarBusy(true); setSummarError('');
    try {
      // El navegador solo sube el PDF — leerlo dentro de Safari/iPhone
      // fallaba adentro de page.getTextContent() (confirmado con stack
      // trace real), algo específico de WebKit que no depende de la versión
      // de iOS. La lectura y el análisis del PDF ahora son 100% del
      // servidor (build "legacy/" de pdfjs-dist, pensada para Node — ver
      // lib/summar-actions.ts).
      const result = await parseSummarStatementAction(fields);
      setSummarPreview(result);
      setSummarSelected(new Set(result.actionable.map(m => m.loadId)));
      if (!result.actionable.length && !result.alreadyPaid.length && !result.denied.length && !result.other.length) setSummarError(t('No se encontró ninguna carga registrada en el sistema dentro de este PDF.'));
    } catch (e) { setSummarError((e as Error).message); } finally { setSummarBusy(false); }
  }
  async function confirmSummar() {
    if (!summarPreview || summarBusy || !summarSelected.size) return;
    setSummarBusy(true); setSummarError('');
    try {
      const inputs = summarPreview.actionable.filter(m => summarSelected.has(m.loadId)).map(m => ({ loadId: m.loadId, invoiceAmount: m.invoiceAmount, fundedAmount: m.fundedAmount }));
      const result = await commitSummarBatchAction(inputs, summarPreview.reportDate || today());
      await loads.refresh();
      setSummarOpen(false); setSummarPreview(null); setSummarSelected(new Set());
      setNotice(`${t('¡Listo!')} ${result.applied} ${t('carga(s) marcadas como pagadas desde el statement de Summar.')}`);
    } catch (e) { setSummarError((e as Error).message); } finally { setSummarBusy(false); }
  }

  // Resumen chiquito (pedido explícito): las cargas que tocan entregarse hoy,
  // para que la dueña las chequee de un vistazo — sin botones, solo lista.
  // Este resumen no se separa por grupo (pedido explícito) — se ven todas
  // juntas, una debajo de otra. Se quedan aquí mientras no salgan pagadas en
  // Summar, sin importar si ya se marcaron "Entregada" operativamente.
  const dueToday = state.loads.filter(l => isOfficial(l) && l.status !== 'Cancelada' && l.status !== 'Reemplazada' && l.paymentStatus !== 'Pagada' && l.deliveryDate === today());
  // Recordatorio de pago semanal (pedido explícito): cuándo salió cada
  // chofer de FL y qué cargas ha hecho desde entonces, para saber cuándo y
  // cuánto pagarle aunque se pase semanas sin volver.
  const tripDrivers = groupFilter ? fleet.state.drivers.filter(d => d.group === groupFilter) : fleet.state.drivers;
  // Un viaje ya pagado (grupo Mario) sale de la lista solo — ya no hace
  // falta seguir recordándolo (pedido explícito).
  const driverTrips = ready ? computeDriverTrips(tripDrivers, state.loads, today()).filter(trip => {
    if (trip.group !== 'Mario') return true;
    const mark = settlements.state.marks.find(m => m.driverId === trip.driverId && m.weekStart === trip.tripStart);
    return mark?.paymentStatus !== 'Pagada';
  }) : [];

  // Tabla semanal igual a la que la dueña hace a mano (pedido explícito),
  // para no perderse chequeando las cargas de la semana — una carga entra
  // en la semana según su FECHA DE ENTREGA (no la de recogida ni la de
  // pago), confirmado explícitamente por ella.
  // El resumen ya no se muestra siempre en la pantalla (pedido explícito: se
  // veía como un reguero de cargas apiladas, sobre todo en el móvil) — ahora
  // vive detrás de un botón, y se abre como una vista aparte, compacta,
  // pensada para caber completa en la pantalla de un teléfono sin tener que
  // moverla para verla.
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryDownloadBusy, setSummaryDownloadBusy] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  async function downloadSummaryImage() {
    if (!summaryRef.current || summaryDownloadBusy) return;
    setSummaryDownloadBusy(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(summaryRef.current, { backgroundColor: '#FBF8F6', scale: 2 });
      const link = document.createElement('a');
      link.download = `resumen-semanal-${summaryWeekStart}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } finally { setSummaryDownloadBusy(false); }
  }
  const [summaryWeekStart, setSummaryWeekStart] = useState(weekStartOf(today()));
  const { end: summaryWeekEnd, prevWeek: summaryPrevWeek, nextWeek: summaryNextWeek } = weekRange(summaryWeekStart);
  const summaryWeekLabel = `${dayLabel(summaryWeekStart)} – ${dayLabel(new Date(new Date(`${summaryWeekEnd}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10))}`;
  const WEEKDAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const entregaLabel = (l: Load) => {
    const pDay = l.pickupDate ? Number(l.pickupDate.slice(8, 10)) : null;
    const dDay = l.deliveryDate ? Number(l.deliveryDate.slice(8, 10)) : null;
    const weekday = l.deliveryDate ? WEEKDAYS_ES[new Date(`${l.deliveryDate}T12:00:00Z`).getUTCDay()].toUpperCase() : '';
    return pDay != null && dDay != null ? `${pDay}-${dDay} ${weekday}` : weekday;
  };
  const summaryGroups = FLEET_GROUPS.map(g => ({
    group: g,
    rows: state.loads
      .filter(l => fleet.state.drivers.find(d => d.id === l.driverId)?.group === g && isOfficial(l) && l.status !== 'Cancelada' && l.status !== 'Reemplazada' && l.deliveryDate >= summaryWeekStart && l.deliveryDate < summaryWeekEnd)
      .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate)),
  }));

  function open(type: Editor['type'], id = '') { setError(''); setNotice(''); setEditor({ type, id, revision: state.revision }); requestAnimationFrame(() => document.getElementById('loads-editor')?.scrollIntoView({ block: 'start', behavior: 'instant' })); }
  const editLoad = editor?.type === 'load' ? state.loads.find(l => l.id === editor.id) : undefined;
  const target = editor ? state.loads.find(l => l.id === editor.id) : undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editor || busy) return; const fields = new FormData(event.currentTarget); const text = (key: string) => String(fields.get(key) || '').trim(); const num = (key: string) => Number(fields.get(key) || 0);
    setError(''); setBusy(true);
    try {
      let action: LoadAction;
      if (editor.type === 'load' || editor.type === 'replace') {
        const record: Load = {
          id: editor.type === 'load' ? (editor.id || crypto.randomUUID()) : crypto.randomUUID(),
          loadNumber: text('loadNumber'), broker: '',
          driverId: text('driverId'), truckId: '', trailerId: '',
          pickupCity: '', pickupState: text('pickupState'), pickupDate: text('pickupDate'),
          deliveryCity: '', deliveryState: text('deliveryState'), deliveryDate: text('deliveryDate'),
          amount: num('amount'), status: text('status') as LoadStatus, missingPod: false,
          paymentStatus: text('paymentStatus') as PaymentStatus, amountReceived: num('amountReceived'), paidAt: '', notes: text('notes'),
          approval: 'Pendiente', approvedBy: '', approvedAt: '', rejectedReason: '', cancelReason: '', cancelledAt: '', cancelledBy: '', replacesId: '', replacedBy: '',
          incidentNote: '', incidentCost: 0, incidentReportedAt: '', dispatcherExempt: false,
        };
        action = editor.type === 'load' ? { type: 'load', record, reason: text('reason') } : { type: 'replace', id: editor.id, replacement: record, reason: text('reason') };
      } else if (editor.type === 'cancel') {
        action = { type: 'cancel', id: editor.id, reason: text('reason') };
      } else {
        action = { type: 'incident', id: editor.id, note: text('incidentNote'), cost: num('incidentCost') };
      }
      const next = await loads.commit(action, editor.revision);
      setEditor(null); setNotice(next.events[0].detail);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const changeGroup = (next: string | null) => { setGroupFilter(next); setEditor(null); setError(''); setNotice(''); };
  async function submitPay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!payTrip || payBusy) return;
    const amount = Number(payAmount);
    if (!(amount >= 0)) { setPayError(t('Escribe un monto válido.')); return; }
    setPayBusy(true); setPayError('');
    try {
      await settlements.commit({ type: 'mark', driverId: payTrip.driverId, driverName: payTrip.driverName, weekStart: payTrip.tripStart, paymentStatus: 'Pagada', notes: '', amountPaid: amount });
      setPayTrip(null); setPayAmount('');
    } catch (e) {
      // En producción Next.js reemplaza el mensaje real de cualquier error
      // de servidor por uno genérico en inglés — se deja en la consola para
      // diagnosticar (Runtime Logs de Vercel), pero a la dueña se le muestra
      // uno claro en español, nunca el técnico.
      console.error(e);
      setPayError(t('No se pudo guardar el salario. Intenta de nuevo.'));
    } finally { setPayBusy(false); }
  }
  async function reopenPay(driverId: string, driverName: string, tripStart: string) {
    try { await settlements.commit({ type: 'mark', driverId, driverName, weekStart: tripStart, paymentStatus: 'Pendiente', notes: '' }); }
    catch (e) { console.error(e); setPayError(t('No se pudo guardar el cambio. Intenta de nuevo.')); }
  }
  const editorTitle = editor?.type === 'load' ? `${editor.id ? t('Editar') : t('Agregar')} ${t('carga')}` : editor?.type === 'cancel' ? t('Cancelar carga') : editor?.type === 'incident' ? t('Reportar rotura de camión') : t('Reemplazar carga');

  return <div className={styles.loads}>
    {loads.error && <div role="alert" className={styles.error}>{loads.error} <button onClick={() => void loads.refresh()}>{t('Reintentar')}</button></div>}
    {!ready && !loads.error && <p role="status">{t('Abriendo los registros de cargas…')}</p>}

    <section className={styles.dueTodayBox}>
      <h3 className={styles.dueTodayTitle}>📦 {t('Cargas que se entregan hoy')} <span className={styles.count}>{dueToday.length}</span></h3>
      {dueToday.length
        ? <ul className={styles.dueTodayList}>{dueToday.map(l => <li key={l.id}>
            <strong>{l.driverId ? driverName(l.driverId) : t('Sin chofer')}</strong> — {t('Carga')} {l.loadNumber || t('sin número')} — {money(l.amount)}
          </li>)}</ul>
        : <p className={styles.empty}>{t('No hay cargas para entregar hoy.')}</p>}
    </section>

    <nav className={styles.tabs} aria-label={t('Grupos de la flota')}>
      <button aria-pressed={groupFilter === null} onClick={() => changeGroup(null)}>{t('Todos los grupos')}</button>
      {FLEET_GROUPS.map(g => <button key={g} aria-pressed={groupFilter === g} onClick={() => changeGroup(g)}>{t(g)}</button>)}
    </nav>

    <section className={styles.tripBox}>
      <h3 className={styles.dueTodayTitle}>🧭 {t('Recorrido de cada chofer (desde que salió de FL)')} <span className={styles.count}>{driverTrips.length}</span></h3>
      {driverTrips.length
        ? <div className={styles.tripList}>{driverTrips.map(trip => {
            const gross = trip.loads.reduce((s, l) => s + l.amount, 0);
            const isMario = trip.group === 'Mario';
            const estimatedPay = isMario ? driverPayForGross(gross, settlements.state.config) : 0;
            const mark = isMario ? settlements.state.marks.find(m => m.driverId === trip.driverId && m.weekStart === trip.tripStart) : undefined;
            const isPaid = mark?.paymentStatus === 'Pagada';
            const isPayingThis = payTrip?.driverId === trip.driverId && payTrip?.tripStart === trip.tripStart;
            return <div className={styles.tripCard} key={trip.driverId} data-tone={trip.daysOut > 10 ? 'red' : trip.daysOut > 7 ? 'orange' : 'gray'}>
            <strong>{trip.driverName}</strong> <span className={styles.tableSub}>({trip.group})</span>
            <span>{t('Salió de FL:')} {dayLabel(trip.tripStart)} — <b>{trip.daysOut} {t('días fuera')}</b></span>
            <ul className={styles.tripLoads}>{trip.loads.map(l => <li key={l.id} className={styles.tripLoadRow}>
              {canEdit && <details className={styles.loadMenu}>
                <summary aria-label={t('Opciones de la carga')}>☰</summary>
                <div className={styles.loadMenuActions}>
                  <button type="button" onClick={() => open('load', l.id)}>{t('Editar')}</button>
                  <button type="button" onClick={() => open('incident', l.id)}>{l.incidentNote ? t('Editar rotura') : t('Reportar rotura')}</button>
                  <button type="button" onClick={() => open('cancel', l.id)}>{t('Cancelar')}</button>
                </div>
              </details>}
              <span>
                {dayLabel(l.pickupDate)} → {l.deliveryDate ? dayLabel(l.deliveryDate) : t('sin fecha de entrega')}: {l.pickupState || '—'} → {l.deliveryState || '—'}{l.loadNumber && ` (#${l.loadNumber})`} — {money(l.amount)}
                {l.incidentNote && <span className={styles.tripIncidentTag}>🔧 {t('Retrasada')}</span>}
                {l.paymentStatus === 'Pagada' && <span className={styles.tripPaidTag}>{t('Pagada')}</span>}
              </span>
            </li>)}</ul>
            {isMario && <>
              <p className={styles.tripTotals}><b>{t('Total en cargas:')}</b> {money(gross)} <span className={styles.tripDivider}>—</span> <b>{t('Salario estimado:')}</b> {money(estimatedPay)}</p>
              {isPaid && <p className={styles.tripPaidLine}>✅ {t('Pagado:')} {money(mark!.amountPaid)}
                {canEdit && <button type="button" onClick={() => { setPayTrip({ driverId: trip.driverId, driverName: trip.driverName, tripStart: trip.tripStart }); setPayAmount(String(mark!.amountPaid)); setPayError(''); }}>{t('Editar')}</button>}
                {canEdit && <button type="button" onClick={() => void reopenPay(trip.driverId, trip.driverName, trip.tripStart)}>{t('Marcar pendiente')}</button>}
              </p>}
              {canEdit && (isPayingThis
                ? <form onSubmit={submitPay} className={styles.payForm}>
                    <input type="number" step="0.01" min="0" value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder={t('Monto pagado')} autoFocus />
                    <button type="submit" disabled={payBusy}>{payBusy ? t('Guardando…') : t('Confirmar')}</button>
                    <button type="button" disabled={payBusy} onClick={() => { setPayTrip(null); setPayError(''); }}>{t('Cancelar')}</button>
                  </form>
                : !isPaid && <button type="button" onClick={() => { setPayTrip({ driverId: trip.driverId, driverName: trip.driverName, tripStart: trip.tripStart }); setPayAmount(estimatedPay.toFixed(2)); setPayError(''); }}>{t('Marcar como pagado')}</button>)}
              {isPayingThis && payError && <p className={styles.error} role="alert">{payError}</p>}
            </>}
          </div>;
          })}</div>
        : <p className={styles.empty}>{ready ? t('Todos los choferes están en FL ahora mismo.') : t('Cargando…')}</p>}
    </section>

    <div className={styles.toolbarRow}>
      <button className={styles.primary} onClick={() => setSummaryOpen(true)}>📊 {t('Ver resumen semanal')}</button>
    </div>

    {summaryOpen && <div className={styles.summaryOverlay}>
      <div className={styles.summaryPanel}>
        <div className={styles.summaryPanelHeader}>
          <button onClick={() => setSummaryOpen(false)} aria-label={t('Cerrar')}>‹</button>
          <span>{t('Resumen semanal')}</span>
          <button onClick={downloadSummaryImage} disabled={summaryDownloadBusy} aria-label={t('Descargar como imagen')}>{summaryDownloadBusy ? '…' : '⬇'}</button>
        </div>
        <div className={styles.weekBar}>
          <button onClick={() => setSummaryWeekStart(summaryPrevWeek)} aria-label={t('Semana anterior')}>←</button>
          <span>{summaryWeekLabel}</span>
          <button onClick={() => setSummaryWeekStart(summaryNextWeek)} aria-label={t('Semana siguiente')}>→</button>
        </div>
        <button onClick={() => setSummaryWeekStart(weekStartOf(today()))} className={styles.summaryTodayBtn}>{t('Semana actual')}</button>
        <div ref={summaryRef} className={styles.summaryCapture}>
          {summaryGroups.map(g => g.rows.length > 0 && <div key={g.group}>
            <div className={styles.summaryGroupHeader}>{g.group === 'Mario' ? t('MARIO') : g.group === 'Owner Operators' ? t('OWNER OPERATORS') : t('CARGAS DE LAZARO')}</div>
            <table className={styles.summaryTable}>
              <colgroup><col style={{ width: '19%' }} /><col style={{ width: '15%' }} /><col style={{ width: '16%' }} /><col style={{ width: '13%' }} /><col style={{ width: '20%' }} /><col style={{ width: '13%' }} /></colgroup>
              <thead><tr><th>{t('CHOFER')}</th><th>{t('CARGA')}</th><th>{t('PRECIO')}</th><th>{t('RUTA')}</th><th>{t('FECHAS')}</th><th>{t('SUM.')}</th></tr></thead>
              <tbody>{g.rows.map(l => <tr key={l.id}>
                <td>{driverName(l.driverId)}</td>
                <td>{l.loadNumber || '—'}</td>
                <td>{money(l.amount)}</td>
                <td>{l.pickupState}-{l.deliveryState}</td>
                <td>{entregaLabel(l)}</td>
                <td>{l.paymentStatus === 'Pagada' ? 'LIST' : ''}</td>
              </tr>)}</tbody>
            </table>
          </div>)}
          {ready && !summaryGroups.some(g => g.rows.length) && <p className={styles.empty}>{t('No hay cargas con entrega esta semana.')}</p>}
        </div>
      </div>
    </div>}

    {notice && <p role="status" className={styles.success}>{notice}</p>}

    {canEdit && <div className={styles.toolbarRow}>
      <button className={`${styles.primary} ${styles.registerBtn}`} disabled={!ready || busy} onClick={() => open('load')}>{t('+ Registrar carga')}</button>
    </div>}
    {canEdit && <div className={styles.toolbarRow}>
      <button className={styles.primary} disabled={!ready || busy} onClick={openSummar}>{t('+ Subir Summar')}</button>
    </div>}

    {canEdit && summarOpen && <div id="summar-import" className={styles.form}>
      <h3>{t('Subir statement de Summar')}</h3>
      <p><small>{t('Copia el PDF que te manda Summar (Purchase Summary Report) y pégalo aquí — el sistema busca las cargas que ya tienes registradas y propone marcarlas como pagadas.')}</small></p>
      <form onSubmit={submitSummar}>
        <label className={styles.wide}>{t('Archivo PDF *')}<input name="statement" type="file" accept="application/pdf" required disabled={summarBusy} /></label>
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={summarBusy}>{summarBusy ? t('Leyendo…') : t('Analizar PDF')}</button>
          <button type="button" disabled={summarBusy} onClick={() => { setSummarOpen(false); setSummarPreview(null); setSummarError(''); }}>{t('Cancelar')}</button>
        </div>
      </form>
      {summarError && <p className={styles.error} role="alert" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px' }}>{summarError}</p>}
      {summarPreview && <>
        {summarPreview.reportDate && <p><b>{t('Fecha del statement:')}</b> {dayLabel(summarPreview.reportDate)}</p>}
        {summarPreview.actionable.length > 0 && <>
          <h4>{t('Cargas para marcar como pagadas')} ({summarSelected.size}/{summarPreview.actionable.length})</h4>
          <div className={styles.tableWrap}><table className={styles.dataTable}><thead><tr>
            <th></th><th>{t('Chofer')}</th><th>{t('Carga')}</th><th>{t('Facturado')}</th><th>{t('Depositado')}</th>
          </tr></thead><tbody>
            {summarPreview.actionable.map(m => <tr key={m.loadId}>
              <td><input type="checkbox" checked={summarSelected.has(m.loadId)} onChange={e => setSummarSelected(prev => { const next = new Set(prev); if (e.target.checked) next.add(m.loadId); else next.delete(m.loadId); return next; })} /></td>
              <td>{m.driverName.toUpperCase()}</td><td>{m.loadNumber}</td><td>{money(m.invoiceAmount)}</td><td>{money(m.fundedAmount)}</td>
            </tr>)}
          </tbody></table></div>
        </>}
        {summarPreview.alreadyPaid.length > 0 && <>
          <h4>{t('Ya estaban pagadas')}</h4>
          <ul className={styles.tripLoads}>{summarPreview.alreadyPaid.map(m => <li key={m.loadId}>
            {m.driverName} — {m.loadNumber}: {t('sistema')} {money(m.currentAmount)} {Math.abs(m.currentAmount - m.invoiceAmount) > 0.005 ? `⚠ ${t('Summar dice')} ${money(m.invoiceAmount)} — ${t('revisa antes de cambiarla a mano')}` : `✓ ${t('coincide')}`}
          </li>)}</ul>
        </>}
        {summarPreview.denied.length > 0 && <>
          <h4>{t('Denegadas en este statement')}</h4>
          <ul className={styles.tripLoads}>{summarPreview.denied.map((m, i) => <li key={m.loadId + i}>{m.driverName} — {m.loadNumber}: {money(m.invoiceAmount)} ({t('puede reaparecer pagada más adelante')})</li>)}</ul>
        </>}
        {summarPreview.other.length > 0 && <>
          <h4>{t('Otras (revisar a mano)')}</h4>
          <ul className={styles.tripLoads}>{summarPreview.other.map((m, i) => <li key={m.loadId + i}>{m.driverName} — {m.loadNumber} ({m.section})</li>)}</ul>
        </>}
        {(summarPreview.actionable.length > 0) && <div className={styles.actions}>
          <button className={styles.primary} disabled={summarBusy || !summarSelected.size} onClick={confirmSummar}>{summarBusy ? t('Aplicando…') : `${t('Confirmar y marcar pagadas')} (${summarSelected.size})`}</button>
        </div>}
      </>}
    </div>}

    {canEdit && editor && <form id="loads-editor" className={styles.form} onSubmit={submit} key={`${editor.type}-${editor.id}`}>
      <h3>{editorTitle}</h3>
      {(editor.type === 'load' || editor.type === 'replace') && <div className={styles.fields}>
        <label>{t('Chofer')}<select name="driverId" defaultValue={editor.type === 'load' ? editLoad?.driverId || '' : target?.driverId || ''}><option value="">{t('Sin asignar')}</option>{fleet.state.drivers.filter(d => d.active).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>{t('Número de carga')}<input name="loadNumber" maxLength={100} defaultValue={editor.type === 'load' ? editLoad?.loadNumber : ''} /></label>
        <label>{t('Tarifa (monto bruto)')}<input name="amount" type="number" step="0.01" min="0" defaultValue={editor.type === 'load' ? editLoad?.amount ?? 0 : 0} /></label>
        <label>{t('Estado de recogida')}<input name="pickupState" maxLength={50} defaultValue={editor.type === 'load' ? editLoad?.pickupState : ''} /></label>
        <label>{t('Estado de entrega')}<input name="deliveryState" maxLength={50} defaultValue={editor.type === 'load' ? editLoad?.deliveryState : ''} /></label>
        <label>{t('Fecha de recogida *')}<input name="pickupDate" type="date" required defaultValue={editor.type === 'load' ? (editLoad?.pickupDate || today()) : today()} /></label>
        <label>{t('Fecha de entrega')}<input name="deliveryDate" type="date" defaultValue={editor.type === 'load' ? editLoad?.deliveryDate : ''} /></label>
        <label>{t('Estado operativo')}<select name="status" defaultValue={editor.type === 'load' ? editLoad?.status || 'Programado' : 'Programado'}>{LOAD_STATUS_VALUES.filter(s => s !== 'Cancelada' && s !== 'Reemplazada').map(s => <option key={s} value={s}>{t(s)}</option>)}</select></label>
        <label>{t('Estado de pago')}<select name="paymentStatus" defaultValue={editor.type === 'load' ? editLoad?.paymentStatus || 'Pendiente' : 'Pendiente'}>{PAYMENT_STATUS_VALUES.map(s => <option key={s} value={s}>{t(s)}</option>)}</select></label>
        <label>{t('Monto recibido')}<input name="amountReceived" type="number" step="0.01" min="0" defaultValue={editor.type === 'load' ? editLoad?.amountReceived ?? 0 : 0} /></label>
        <label className={styles.wide}>{t('Notas')}<textarea name="notes" rows={3} maxLength={3000} defaultValue={editor.type === 'load' ? editLoad?.notes : ''} /></label>
        {(editor.type === 'replace' || editor.id) && <label className={styles.wide}>{t('Motivo del cambio *')}<input name="reason" required maxLength={500} /></label>}
      </div>}
      {editor.type === 'cancel' && <><p>{t('La carga no se borra: queda cancelada en el historial con el motivo.')}</p><label>{t('Motivo de la cancelación *')}<input name="reason" required maxLength={500} /></label></>}
      {editor.type === 'incident' && <div className={styles.fields}>
        <p className={styles.wide}>{t('Anota qué se rompió y cuánto costó, para que quede la carga marcada como atrasada por rotura.')}</p>
        <label className={styles.wide}>{t('¿Qué se rompió?')}<input name="incidentNote" maxLength={500} placeholder={t('Ej: se ponchó una llanta, se rompió el motor…')} defaultValue={target?.incidentNote} /></label>
        <label>{t('Costo de la reparación')}<input name="incidentCost" type="number" step="0.01" min="0" defaultValue={target?.incidentCost ?? 0} /></label>
        <p className={styles.wide}><small>{t('Deja "¿Qué se rompió?" vacío y guarda para quitar el reporte cuando ya esté resuelto.')}</small></p>
      </div>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{busy ? t('Guardando…') : t('Guardar')}</button><button type="button" disabled={busy} onClick={() => { setEditor(null); setError(''); }}>{t('Cancelar')}</button></div>
    </form>}

  </div>;
}
