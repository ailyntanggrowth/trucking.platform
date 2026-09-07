"use client";
import { useState } from 'react';
import LoadsModule from './loads-module';
import FleetModule from './fleet-module';
import { driverStatus } from '../lib/fleet';
import type { LoadsController } from '../lib/use-loads';
import type { FleetController } from '../lib/use-fleet';
import type { Load } from '../lib/dashboard';
import type { Lang } from '../lib/i18n';
import { Users } from 'lucide-react';
import styles from './cargas-flota.module.css';

// Módulos 01 (Cargas) y 02 (Choferes y Flota) fusionados en uno solo, a pedido
// directo de la dueña — antes eran dos entradas separadas en el menú. Por
// defecto se ve una tira compacta de choferes activos (Mario + Owner
// Operators, igual que ya filtraba Choferes y Flota) arriba de Cargas
// completo; un clic en "Ver flota completa" abre Choferes y Flota entero
// (camiones, trailers, asignaciones, documentos) sin perder nada de eso.
// La dispatcher no tiene ninguna de las dos cosas de flota (spec: solo Cargas).
export default function CargasFlotaModule({ loads, fleet, dashboardLoads, canSeeFleet, lang, t }: {
  loads: LoadsController; fleet: FleetController; dashboardLoads: Load[]; canSeeFleet: boolean; lang: Lang; t: (es: string) => string;
}) {
  const [showFleet, setShowFleet] = useState(false);
  const activeDrivers = fleet.state.drivers.filter(d => d.active && (d.group === 'Mario' || d.group === 'Owner Operators'));

  if (canSeeFleet && showFleet) return <div className={styles.wrap}>
    <button className={styles.backLink} onClick={() => setShowFleet(false)}>{t('← Volver a Cargas')}</button>
    <FleetModule fleet={fleet} loads={dashboardLoads} onOpenLoads={() => setShowFleet(false)} lang={lang} t={t} initialTab="drivers" />
  </div>;

  return <div className={styles.wrap}>
    {canSeeFleet && <section className={styles.driverStrip}>
      <div className={styles.driverStripHeader}>
        <h3><Users size={16} /> {t('Choferes activos')}</h3>
        <button className={styles.fleetLink} onClick={() => setShowFleet(true)}>{t('Ver flota completa →')}</button>
      </div>
      {activeDrivers.length ? <div className={styles.driverList}>{activeDrivers.map(d => <span className={styles.driverChip} key={d.id}>{d.name} <small>{t(driverStatus(d))}</small></span>)}</div>
        : <p className={styles.empty}>{fleet.ready ? t('No hay choferes activos todavía.') : t('Cargando…')}</p>}
    </section>}
    <LoadsModule loads={loads} fleet={fleet} lang={lang} t={t} initialFilter="Por revisar" />
  </div>;
}
