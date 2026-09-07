"use client";
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatController } from '../lib/use-chat';
import { dateLabel } from '../lib/format';
import type { Lang } from '../lib/i18n';
import { Send, Search, Plus, ArrowLeft, Users } from 'lucide-react';
import styles from './chat.module.css';

type Tab = 'todos' | 'grupos' | 'noleidos';
const AVATAR_TONES = ['#8B102A', '#1e4e8c', '#8a5a00', '#1f7a4d', '#6b3fa0', '#a12b2b', '#0f7a7a'];
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?';
function hashIndex(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
function Avatar({ name, isGroup }: { name: string; isGroup?: boolean }) {
  const tone = AVATAR_TONES[hashIndex(name) % AVATAR_TONES.length];
  return <span className={styles.avatar} style={{ background: tone }}>{isGroup ? <Users size={16} /> : initials(name)}</span>;
}

export default function ChatModule({ chat, myId, canStartConversations = true, lang, t }: { chat: ChatController; myId: string; canStartConversations?: boolean; lang: Lang; t: (es: string) => string }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('todos');
  const [query, setQuery] = useState('');
  const [mobileView, setMobileView] = useState<'list' | 'thread'>('list');
  const [newOpen, setNewOpen] = useState(false);
  const [newSelected, setNewSelected] = useState<Set<string>>(new Set());
  const [newGroupName, setNewGroupName] = useState('');
  const [newBusy, setNewBusy] = useState(false);
  const [newError, setNewError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [chat.messages.length]);

  const active = chat.conversations.find(c => c.id === chat.activeId) || null;
  const filtered = chat.conversations
    .filter(c => tab === 'grupos' ? c.isGroup : tab === 'noleidos' ? c.unreadCount > 0 : true)
    .filter(c => c.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const unreadTotal = chat.conversations.reduce((s, c) => s + c.unreadCount, 0);

  function selectConversation(id: string) { chat.openConversation(id); setMobileView('thread'); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true); setError('');
    try { await chat.send(text); setText(''); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  function toggleContact(id: string) { setNewSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  async function submitNew(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (newBusy || !newSelected.size) return;
    setNewBusy(true); setNewError('');
    try {
      await chat.startConversation(Array.from(newSelected), newGroupName);
      setNewOpen(false); setNewSelected(new Set()); setNewGroupName(''); setMobileView('thread');
    } catch (e) { setNewError((e as Error).message); } finally { setNewBusy(false); }
  }

  return <div className={styles.chat}>
    {chat.error && <p role="alert" className={styles.error}>{chat.error}</p>}
    {!chat.ready && !chat.error && <p role="status">{t('Abriendo el chat…')}</p>}
    <div className={`${styles.layout} ${styles[`view-${mobileView}`]}`}>
      <aside className={styles.sidebar}>
        {canStartConversations && <button type="button" className={styles.newBtn} onClick={() => { setNewOpen(v => !v); setNewError(''); }}><Plus size={16} /> {t('Nueva Conversación')}</button>}
        {newOpen && <form className={styles.newForm} onSubmit={submitNew}>
          <p className={styles.newHint}>{t('Elige una o más personas. Si eliges más de una, se crea un grupo.')}</p>
          <div className={styles.contactList}>
            {chat.contacts.map(c => <label key={c.id} className={styles.contactRow}>
              <input type="checkbox" checked={newSelected.has(c.id)} onChange={() => toggleContact(c.id)} /> <Avatar name={c.name} /> {c.name}
            </label>)}
            {!chat.contacts.length && <p className={styles.empty}>{t('No hay más compañeros con acceso todavía.')}</p>}
          </div>
          {newSelected.size > 1 && <label className={styles.groupNameField}>{t('Nombre del grupo (opcional)')}<input type="text" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} maxLength={80} placeholder={t('Ej. Operaciones')} /></label>}
          {newError && <p role="alert" className={styles.error}>{newError}</p>}
          <div className={styles.newActions}><button type="submit" className={styles.primary} disabled={newBusy || !newSelected.size}>{newBusy ? t('Creando…') : t('Iniciar')}</button><button type="button" onClick={() => setNewOpen(false)}>{t('Cancelar')}</button></div>
        </form>}
        <label className={styles.searchField}><Search size={16} aria-hidden="true" /><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Buscar conversaciones…')} /></label>
        <nav className={styles.chatTabs}>
          <button aria-pressed={tab === 'todos'} onClick={() => setTab('todos')}>{t('Todos')}</button>
          <button aria-pressed={tab === 'grupos'} onClick={() => setTab('grupos')}>{t('Grupos')}</button>
          <button aria-pressed={tab === 'noleidos'} onClick={() => setTab('noleidos')}>{t('No leídos')}{unreadTotal > 0 ? ` (${unreadTotal})` : ''}</button>
        </nav>
        <div className={styles.convList}>
          {filtered.map(c => <button key={c.id} className={`${styles.convItem} ${c.id === chat.activeId ? styles.convItemActive : ''}`} onClick={() => selectConversation(c.id)}>
            <Avatar name={c.name} isGroup={c.isGroup} />
            <span className={styles.convMeta}>
              <span className={styles.convTop}><strong>{c.name}</strong>{c.lastMessage && <span className={styles.convTime}>{dateLabel(c.lastMessage.createdAt)}</span>}</span>
              <span className={styles.convBottom}>
                <span className={styles.convPreview}>{c.lastMessage ? `${c.lastMessage.senderId === myId ? t('Tú:') + ' ' : ''}${c.lastMessage.body}` : t('Sin mensajes todavía')}</span>
                {c.unreadCount > 0 && <span className={styles.unreadBadge}>{c.unreadCount}</span>}
              </span>
            </span>
          </button>)}
          {chat.ready && !filtered.length && <p className={styles.empty}>{t('No hay conversaciones que coincidan.')}</p>}
        </div>
      </aside>

      <section className={styles.thread}>
        {active ? <>
          <header className={styles.threadHeader}>
            <button type="button" className={styles.backBtn} onClick={() => setMobileView('list')} aria-label={t('Volver')}><ArrowLeft size={18} /></button>
            <Avatar name={active.name} isGroup={active.isGroup} />
            <span className={styles.threadTitle}>
              <strong>{active.name}</strong>
              {active.isGroup && <span className={styles.threadSub}>{active.memberNames.join(', ')}</span>}
            </span>
          </header>
          <div className={styles.messages}>
            {chat.messages.map(m => <div key={m.id} className={`${styles.bubbleRow} ${m.senderId === myId ? styles.mine : ''}`}>
              {m.senderId !== myId && <Avatar name={m.senderName} />}
              <div className={styles.bubble}>
                {m.senderId !== myId && active.isGroup && <strong className={styles.sender}>{m.senderName}</strong>}
                <p>{m.body}</p>
                <span className={styles.time}>{dateLabel(m.createdAt)}</span>
              </div>
            </div>)}
            {chat.ready && !chat.messages.length && <p className={styles.empty}>{t('Todavía no hay mensajes. Escribe el primero.')}</p>}
            <div ref={bottomRef} />
          </div>
          {error && <p role="alert" className={styles.error}>{error}</p>}
          <form className={styles.composer} onSubmit={submit}>
            <input type="text" value={text} onChange={e => setText(e.target.value)} placeholder={t('Escribe un mensaje…')} maxLength={4000} disabled={busy} />
            <button type="submit" className={styles.sendBtn} disabled={busy || !text.trim()} aria-label={t('Enviar')}><Send size={16} /></button>
          </form>
        </> : <p className={styles.empty}>{chat.ready ? t('Elige o crea una conversación para empezar.') : ''}</p>}
      </section>
    </div>
  </div>;
}
