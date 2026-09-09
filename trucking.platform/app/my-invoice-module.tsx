"use client";
import { useState } from 'react';
import { dispatcherCommissionDetail, invoiceNumberFor, weekStartOf, weekRange } from '../lib/settlements';
import type { SettlementsController } from '../lib/use-settlements';
import type { LoadsController } from '../lib/use-loads';
import type { FleetController } from '../lib/use-fleet';
import { money, today } from '../lib/format';
import type { Lang } from '../lib/i18n';
import { ChevronLeft, ChevronRight, DollarSign } from 'lucide-react';
import styles from './my-invoice.module.css';

export default function MyInvoiceModule({ settlements, loads, fleet, lang, t }: {
  settlements: SettlementsController; loads: LoadsController; fleet: FleetController; lang: Lang; t: (es: string) => string;
}) {
  const [weekStart, setWeekStart] = useState(weekStartOf(today()));
  const ready = settlements.ready && loads.ready && fleet.ready;
  const { end: weekEnd, prevWeek, nextWeek } = weekRange(weekStart);
  const weekLabel = `${new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(`${weekStart}T12:00:00Z`))} – ${new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(new Date(`${weekEnd}T12:00:00Z`).getTime() - 86400000))}`;
  const result = dispatcherCommissionDetail(fleet.state.drivers, loads.state.loads, weekStart, weekEnd, settlements.state.config, settlements.state.weekLocks);
  const invoiceNumber = invoiceNumberFor(weekStart);
  // Solo un Administrador marca si ya se le pagó el invoice (pedido explícito
  // de la dueña) — aquí es de solo lectura.
  const mark = settlements.state.dispatcherMarks.find(m => m.weekStart === weekStart);
  const invoicePaid = mark?.paymentStatus === 'Pagada';

  // Historial: últimas semanas con cargas o marca de pago, para que vea todo
  // su trabajo (no solo la semana actual).
  // El sistema arranca de cero desde el invoice #43 (pedido explícito) — el
  // historial nunca muestra invoices anteriores a ese, aunque existan cargas
  // viejas canceladas de antes del reinicio.
  const SYSTEM_START_INVOICE = 43;
  const history: { weekStart: string; invoiceNumber: number; label: string; commission: number; paid: boolean }[] = [];
  for (let i = 0; i < 8; i++) {
    const ws = i === 0 ? weekStartOf(today()) : weekRange(history[i - 1].weekStart).prevWeek;
    if (invoiceNumberFor(ws) < SYSTEM_START_INVOICE) break;
    const { end } = weekRange(ws);
    const c = ready ? dispatcherCommissionDetail(fleet.state.drivers, loads.state.loads, ws, end, settlements.state.config, settlements.state.weekLocks).commission : 0;
    const m = settlements.state.dispatcherMarks.find(x => x.weekStart === ws);
    history.push({
      weekStart: ws, invoiceNumber: invoiceNumberFor(ws), commission: c, paid: m?.paymentStatus === 'Pagada',
      label: new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(`${ws}T12:00:00Z`)),
    });
  }

  return <div className={styles.wrap}>
    {!ready && <p role="status">{t('Abriendo tu invoice…')}</p>}
    <div className={styles.weekBar}>
      <button onClick={() => setWeekStart(prevWeek)} disabled={invoiceNumber <= SYSTEM_START_INVOICE} aria-label={t('Semana anterior')}><ChevronLeft size={16} /></button>
      <span>📅 {t('Semana')} {weekLabel}</span>
      <button onClick={() => setWeekStart(nextWeek)} aria-label={t('Semana siguiente')}><ChevronRight size={16} /></button>
      <button onClick={() => setWeekStart(weekStartOf(today()))}>{t('Semana actual')}</button>
    </div>

    <div className={styles.invoiceCard}>
      <span className={styles.invoiceIcon}><DollarSign size={22} /></span>
      <span className={styles.invoiceLabel}>{t('Invoice')} #{invoiceNumber} · {t('4% del bruto de Mario + Owner Operators + Lázaro')}</span>
      <strong className={styles.invoiceAmount}>{ready ? money(result.commission) : '—'}</strong>
      <span className={styles.invoiceSub}>{t('Bruto de la semana:')} {ready ? money(result.gross) : '—'}</span>
      <span className={`${styles.statusBadge} ${invoicePaid ? styles.statusPaid : styles.statusPending}`}>{invoicePaid ? t('Pagado') : t('Pendiente de pago')}</span>
    </div>
    <p className={styles.note}>{t('Este pago es independiente del salario de los choferes — nunca sale de lo que ellos cobran. Solo un Administrador puede marcar el invoice como pagado.')}</p>

    <h3>{t('Cargas que forman este total')}</h3>
    <div className={styles.tableWrap}>
      <table className={styles.dataTable}>
        <thead><tr><th>{t('Chofer')}</th><th>{t('Carga')}</th><th>{t('Bruto')}</th><th>{t('Comisión (4%)')}</th></tr></thead>
        <tbody>
          {result.rows.map(r => <tr key={r.loadId}>
            <td>{r.driverName}</td>
            <td>{r.loadNumber || t('Sin número')}</td>
            <td className={styles.tableSub}>{money(r.amount)}</td>
            <td><strong>{money(r.commission)}</strong></td>
          </tr>)}
          <tr className={styles.tableSub}>
            <td colSpan={2}><b>{t('Total')}</b></td>
            <td><b>{money(result.gross)}</b></td>
            <td><b>{money(result.commission)}</b></td>
          </tr>
        </tbody>
      </table>
      {ready && !result.rows.length && <p className={styles.empty}>{t('No hay cargas de estos choferes en esta semana todavía.')}</p>}
    </div>

    <h3>{t('Tus invoices anteriores')}</h3>
    <div className={styles.tableWrap}>
      <table className={styles.dataTable}>
        <thead><tr><th>{t('Invoice')}</th><th>{t('Semana de')}</th><th>{t('Comisión')}</th><th>{t('Estado')}</th></tr></thead>
        <tbody>{history.map(h => <tr key={h.weekStart} className={`${styles.historyRow} ${h.weekStart === weekStart ? styles.rowActive : ''}`} onClick={() => setWeekStart(h.weekStart)}>
          <td>#{h.invoiceNumber}</td>
          <td className={styles.tableSub}>{h.label}</td>
          <td><strong>{money(h.commission)}</strong></td>
          <td><span className={`${styles.statusBadge} ${h.paid ? styles.statusPaid : styles.statusPending}`}>{h.paid ? t('Pagado') : t('Pendiente')}</span></td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
