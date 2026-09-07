"use client";
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { listProfiles, inviteProfile, updateProfileRole, setProfileActive, removeProfile, listUnlinkedDrivers, type UnlinkedDriver } from '../lib/users-actions';
import { ROLE_VALUES, roleLabel, roleDescription, roleTone, type Profile, type Role } from '../lib/users';
import type { AuthController } from '../lib/use-auth';
import type { Lang } from '../lib/i18n';
import { dateLabel } from '../lib/format';
import { UserPlus, Users, UserCheck, UserX, Search } from 'lucide-react';
import styles from './users.module.css';

type Tab = 'todos' | 'activos' | 'pendientes' | 'inactivos';
const AVATAR_TONES = ['#8B102A', '#1e4e8c', '#8a5a00', '#1f7a4d', '#6b3fa0', '#a12b2b'];
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?';
function hashIndex(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
function status(p: Profile): 'activo' | 'pendiente' | 'inactivo' { return !p.active ? 'inactivo' : !p.lastSignInAt ? 'pendiente' : 'activo'; }

export default function UsersModule({ auth, lang, t }: { auth: AuthController; lang: Lang; t: (es: string) => string }) {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formRole, setFormRole] = useState<Role>('dispatcher');
  const [unlinkedDrivers, setUnlinkedDrivers] = useState<UnlinkedDriver[]>([]);
  const [tab, setTab] = useState<Tab>('todos');
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | 'todos'>('todos');

  async function refresh() {
    try {
      const token = await auth.accessToken();
      const [list, drivers] = await Promise.all([listProfiles(token), listUnlinkedDrivers(token)]);
      setProfiles(list); setUnlinkedDrivers(drivers);
    } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget; // el SyntheticEvent se recicla tras un await — hay que guardar el form antes
    const fields = new FormData(form);
    const email = String(fields.get('email') || ''), name = String(fields.get('name') || ''), role = fields.get('role') as Role;
    const driverId = role === 'driver' ? String(fields.get('driverId') || '') || null : null;
    setError(''); setNotice(''); setBusy(true);
    try {
      const token = await auth.accessToken();
      await inviteProfile(token, email, name, role, driverId);
      setNotice(`${t('Listo — se le envió un link de acceso a')} ${email}.`);
      form.reset();
      setFormOpen(false); setFormRole('dispatcher');
      await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function changeRole(id: string, role: Role) {
    if (busy) return; setError(''); setNotice(''); setBusy(true);
    try { const token = await auth.accessToken(); await updateProfileRole(token, id, role); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function toggleActive(id: string, active: boolean) {
    if (busy) return; setError(''); setNotice(''); setBusy(true);
    try { const token = await auth.accessToken(); await setProfileActive(token, id, active); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function remove(id: string, name: string) {
    if (busy || !window.confirm(`${t('¿Eliminar por completo el acceso de')} ${name}? ${t('Esto no se puede deshacer.')}`)) return;
    setError(''); setNotice(''); setBusy(true);
    try { const token = await auth.accessToken(); await removeProfile(token, id); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const counts = useMemo(() => {
    const list = profiles || [];
    return {
      activos: list.filter(p => status(p) === 'activo').length,
      pendientes: list.filter(p => status(p) === 'pendiente').length,
      inactivos: list.filter(p => status(p) === 'inactivo').length,
    };
  }, [profiles]);

  const filtered = (profiles || [])
    .filter(p => tab === 'todos' ? true : tab === 'activos' ? status(p) === 'activo' : tab === 'pendientes' ? status(p) === 'pendiente' : status(p) === 'inactivo')
    .filter(p => roleFilter === 'todos' ? true : p.role === roleFilter)
    .filter(p => `${p.name} ${p.email}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));

  return <div className={styles.users}>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.success}>{notice}</p>}

    <div className={styles.statCards}>
      <div className={styles.statCard} data-tone="green"><span className={styles.statIcon}><UserCheck size={16} /></span><strong>{counts.activos}</strong><span className={styles.statLabel}>{t('Usuarios Activos')}</span></div>
      <div className={styles.statCard} data-tone="amber"><span className={styles.statIcon}><Users size={16} /></span><strong>{counts.pendientes}</strong><span className={styles.statLabel}>{t('Invitaciones Pendientes')}</span></div>
      <div className={styles.statCard} data-tone="red"><span className={styles.statIcon}><UserX size={16} /></span><strong>{counts.inactivos}</strong><span className={styles.statLabel}>{t('Usuarios Inactivos')}</span></div>
    </div>

    <div className={styles.toolbarRow}>
      <nav className={styles.tabs}>
        <button aria-pressed={tab === 'todos'} onClick={() => setTab('todos')}>{t('Todos')} <span>{(profiles || []).length}</span></button>
        <button aria-pressed={tab === 'activos'} onClick={() => setTab('activos')}>{t('Activos')} <span>{counts.activos}</span></button>
        <button aria-pressed={tab === 'inactivos'} onClick={() => setTab('inactivos')}>{t('Inactivos')} <span>{counts.inactivos}</span></button>
        <button aria-pressed={tab === 'pendientes'} onClick={() => setTab('pendientes')}>{t('Invitaciones')} <span>{counts.pendientes}</span></button>
      </nav>
      <button type="button" className={styles.primary} onClick={() => setFormOpen(v => !v)}><UserPlus size={16} /> {t('+ Agregar Usuario')}</button>
    </div>

    {formOpen && <form className={styles.form} onSubmit={submit}>
      <h3>{t('Agregar persona')}</h3>
      <div className={styles.fields}>
        <label>{t('Nombre *')}<input name="name" required maxLength={100} /></label>
        <label>{t('Correo *')}<input name="email" type="email" required maxLength={200} /></label>
        <label>{t('Acceso *')}<select name="role" value={formRole} onChange={e => setFormRole(e.target.value as Role)}>{ROLE_VALUES.map(r => <option key={r} value={r}>{t(roleLabel(r))}</option>)}</select></label>
        {formRole === 'driver' && <label>{t('Chofer (Choferes y Flota) *')}<select name="driverId" required defaultValue="">
          <option value="" disabled>{t('Elige un chofer…')}</option>
          {unlinkedDrivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select></label>}
      </div>
      {formRole === 'driver' && !unlinkedDrivers.length && <p className={styles.note}>{t('Todos los choferes de Choferes y Flota ya tienen cuenta, o todavía no has agregado ninguno.')}</p>}
      <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{busy ? t('Enviando…') : t('Enviar acceso')}</button><button type="button" onClick={() => setFormOpen(false)}>{t('Cancelar')}</button></div>
      <p className={styles.note}>{t('Le llega un correo con un link para entrar — no necesita crear ninguna contraseña.')}</p>
    </form>}

    <div className={styles.filterRow}>
      <label className={styles.searchField}><Search size={16} aria-hidden="true" /><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Buscar por nombre o correo…')} /></label>
      <select value={roleFilter} onChange={e => setRoleFilter(e.target.value as Role | 'todos')}>
        <option value="todos">{t('Todos los roles')}</option>
        {ROLE_VALUES.map(r => <option key={r} value={r}>{t(roleLabel(r))}</option>)}
      </select>
    </div>

    <div className={styles.tableWrap}>
      <table className={styles.dataTable}>
        <thead><tr><th>{t('Usuario')}</th><th>{t('Correo')}</th><th>{t('Rol')}</th><th>{t('Estado')}</th><th>{t('Último acceso')}</th><th>{t('Acciones')}</th></tr></thead>
        <tbody>{filtered.map(p => { const st = status(p); const tone = roleTone(p.role); const isMe = p.id === auth.profile?.id;
          return <tr key={p.id}>
            <td><span className={styles.who}><span className={styles.avatar} style={{ background: AVATAR_TONES[hashIndex(p.name || p.email) % AVATAR_TONES.length] }}>{initials(p.name || p.email)}</span><span><strong>{p.name || p.email}</strong><span className={styles.tableSub}>{t(roleDescription(p.role))}</span></span></span></td>
            <td className={styles.tableSub}>{p.email}</td>
            <td><span className={styles.rolePill} style={{ background: `${tone}1a`, color: tone }}>{t(roleLabel(p.role))}</span></td>
            <td><span className={`${styles.badge} ${st === 'activo' ? styles.badgeActive : st === 'pendiente' ? styles.badgePending : styles.badgeInactive}`}>{st === 'activo' ? t('Activo') : st === 'pendiente' ? t('Pendiente') : t('Inactivo')}</span></td>
            <td className={styles.tableSub}>{p.lastSignInAt ? dateLabel(p.lastSignInAt) : t('Nunca')}</td>
            <td className={styles.tableActions}>
              {p.role !== 'owner' && !isMe ? <div className={styles.rowActions}>
                <select value={p.role} disabled={busy} onChange={e => void changeRole(p.id, e.target.value as Role)}>{ROLE_VALUES.map(r => <option key={r} value={r}>{t(roleLabel(r))}</option>)}</select>
                <button disabled={busy} onClick={() => void toggleActive(p.id, !p.active)}>{p.active ? t('Desactivar') : t('Activar')}</button>
                <button disabled={busy} onClick={() => void remove(p.id, p.name || p.email)}>{t('Eliminar')}</button>
              </div> : <span className={styles.tableSub}>{isMe ? t('Tú') : t('Cuenta protegida')}</span>}
            </td>
          </tr>; })}</tbody>
      </table>
      {profiles && !filtered.length && <p className={styles.empty}>{t('No hay usuarios que coincidan.')}</p>}
    </div>

    <section className={styles.legendPanel}>
      <h3>{t('Niveles de Permisos')}</h3>
      <ul>{ROLE_VALUES.map(r => <li key={r}><span className={styles.dot} style={{ background: roleTone(r) }} /> <strong>{t(roleLabel(r))}</strong> <span>{t(roleDescription(r))}</span></li>)}</ul>
    </section>
  </div>;
}
