"use client";
import { useEffect, useState, type FormEvent } from 'react';
import { listProfiles, inviteProfile, updateProfileRole, removeProfile } from '../lib/users-actions';
import { ROLE_VALUES, roleLabel, type Profile, type Role } from '../lib/users';
import type { AuthController } from '../lib/use-auth';
import type { Lang } from '../lib/i18n';
import { UserPlus } from 'lucide-react';
import styles from './users.module.css';

export default function UsersModule({ auth, lang, t }: { auth: AuthController; lang: Lang; t: (es: string) => string }) {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);

  async function refresh() {
    try { const token = await auth.accessToken(); setProfiles(await listProfiles(token)); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const fields = new FormData(event.currentTarget);
    const email = String(fields.get('email') || ''), name = String(fields.get('name') || ''), role = fields.get('role') as Role;
    setError(''); setNotice(''); setBusy(true);
    try {
      const token = await auth.accessToken();
      await inviteProfile(token, email, name, role);
      setNotice(`${t('Listo — se le envió un link de acceso a')} ${email}.`);
      event.currentTarget.reset();
      await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function changeRole(id: string, role: Role) {
    if (busy) return; setError(''); setNotice(''); setBusy(true);
    try { const token = await auth.accessToken(); await updateProfileRole(token, id, role); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function remove(id: string, name: string) {
    if (busy || !window.confirm(`${t('¿Quitarle el acceso a')} ${name}?`)) return;
    setError(''); setNotice(''); setBusy(true);
    try { const token = await auth.accessToken(); await removeProfile(token, id); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return <div className={styles.users}>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.success}>{notice}</p>}

    <form className={styles.form} onSubmit={submit}>
      <h3><UserPlus size={18} /> {t('Agregar persona')}</h3>
      <div className={styles.fields}>
        <label>{t('Nombre *')}<input name="name" required maxLength={100} /></label>
        <label>{t('Correo *')}<input name="email" type="email" required maxLength={200} /></label>
        <label>{t('Acceso *')}<select name="role" defaultValue="dispatcher">{ROLE_VALUES.map(r => <option key={r} value={r}>{t(roleLabel(r))}</option>)}</select></label>
      </div>
      <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{busy ? t('Enviando…') : t('+ Enviar acceso')}</button></div>
      <p className={styles.note}>{t('Le llega un correo con un link para entrar — no necesita crear ninguna contraseña.')}</p>
    </form>

    <div className={styles.cards}>{(profiles || []).map(p => <article className={styles.card} key={p.id}>
      <strong>{p.name || p.email}</strong>
      <span>{p.email}</span>
      <div className={styles.roleRow}>
        <select value={p.role} disabled={busy} onChange={e => void changeRole(p.id, e.target.value as Role)}>{ROLE_VALUES.map(r => <option key={r} value={r}>{t(roleLabel(r))}</option>)}</select>
        <button disabled={busy} onClick={() => void remove(p.id, p.name || p.email)}>{t('Quitar acceso')}</button>
      </div>
    </article>)}</div>
    {profiles && !profiles.length && <p className={styles.empty}>{t('Todavía no hay nadie agregado.')}</p>}
  </div>;
}
