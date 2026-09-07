"use client";
import type { MyLoadsController } from '../lib/use-my-loads';
import { isOfficial, isActive, routeLabel } from '../lib/loads';
import { money, dayLabel } from '../lib/format';
import type { Lang } from '../lib/i18n';
import { Truck } from 'lucide-react';
import styles from './my-loads.module.css';

export default function MyLoadsModule({ myLoads, lang, t }: { myLoads: MyLoadsController; lang: Lang; t: (es: string) => string }) {
  const { loads, ready, error } = myLoads;
  const official = loads.filter(isOfficial).sort((a, b) => b.pickupDate.localeCompare(a.pickupDate));
  const activeCount = official.filter(isActive).length;

  return <div className={styles.wrap}>
    {error && <div role="alert" className={styles.error}>{error} <button onClick={() => void myLoads.refresh()}>{t('Reintentar')}</button></div>}
    {!ready && !error && <p role="status">{t('Abriendo tus cargas…')}</p>}

    <div className={styles.statCards}>
      <div className={styles.statCard}><span className={styles.statIcon}><Truck size={16} /></span><strong>{ready ? activeCount : '—'}</strong><span className={styles.statLabel}>{t('Cargas activas')}</span></div>
      <div className={styles.statCard}><strong>{ready ? official.length : '—'}</strong><span className={styles.statLabel}>{t('Total de cargas')}</span></div>
    </div>

    <div className={styles.cards}>{official.map(l => <article className={styles.card} key={l.id}>
      <div className={styles.cardTop}><span className={styles.loadNumber}>{l.loadNumber || t('Sin número')}</span><span className={`${styles.statusPill} ${styles[`status-${l.status.replace(/\s+/g, '')}`] || ''}`}>{t(l.status)}</span></div>
      <strong className={styles.route}>{routeLabel(l)}</strong>
      <div className={styles.dates}>
        <span>{t('Recogida:')} {dayLabel(l.pickupDate)}</span>
        {l.deliveryDate && <span>{t('Entrega:')} {dayLabel(l.deliveryDate)}</span>}
      </div>
      <div className={styles.cardBottom}>
        <span>{t('Bruto:')} <b>{money(l.amount)}</b></span>
        <span className={styles.paymentPill}>{t(l.paymentStatus)}</span>
      </div>
      {l.notes && <p className={styles.notes}>{l.notes}</p>}
    </article>)}</div>
    {ready && !official.length && <p className={styles.empty}>{t('Todavía no tienes cargas asignadas.')}</p>}
  </div>;
}
