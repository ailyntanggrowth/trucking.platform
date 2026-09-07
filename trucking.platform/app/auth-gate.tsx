"use client";
import { useState, type FormEvent, type ReactNode } from 'react';
import type { AuthController } from '../lib/use-auth';
import type { Lang } from '../lib/i18n';
import { Truck } from 'lucide-react';
import styles from './auth-gate.module.css';

export default function AuthGate({ auth, lang, t, children }: { auth: AuthController; lang: Lang; t: (es: string) => string; children: ReactNode }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (auth.status === 'ready') return <>{children}</>;
  if (auth.status === 'loading') return <div className={styles.screen}><div className={styles.logo} aria-hidden="true"><Truck size={26} strokeWidth={1.75} /></div></div>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setError(''); setBusy(true);
    try { await auth.sendMagicLink(email); setSent(true); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  if (auth.status === 'noProfile') return <div className={styles.screen}>
    <div className={styles.card}>
      <div className={styles.logo} aria-hidden="true"><Truck size={26} strokeWidth={1.75} /></div>
      <h1>{t('Sin acceso todavía')}</h1>
      <p>{t('El correo')} <b>{auth.email}</b> {t('no tiene acceso a este sistema. Pídele al administrador que te agregue desde Usuarios y Permisos.')}</p>
      <button onClick={() => void auth.signOut()}>{t('Probar con otro correo')}</button>
    </div>
  </div>;

  return <div className={styles.screen}>
    <div className={styles.card}>
      <div className={styles.logo} aria-hidden="true"><Truck size={26} strokeWidth={1.75} /></div>
      <h1>M&amp;A KING</h1>
      <p className={styles.subtitle}>{t('Escribe tu correo y te mandamos un link para entrar. No necesitas contraseña.')}</p>
      {!sent ? <form onSubmit={submit}>
        <label>{t('Correo')}<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@correo.com" /></label>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button type="submit" className={styles.primary} disabled={busy}>{busy ? t('Enviando…') : t('Enviar link de acceso')}</button>
      </form> : <p className={styles.success} role="status">{t('Listo — revisa tu correo')} <b>{email}</b> {t('y toca el link para entrar.')}</p>}
    </div>
  </div>;
}
