"use client";
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatController } from '../lib/use-chat';
import { dateLabel } from '../lib/format';
import type { Lang } from '../lib/i18n';
import { Send } from 'lucide-react';
import styles from './chat.module.css';

export default function ChatModule({ chat, myId, lang, t }: { chat: ChatController; myId: string; lang: Lang; t: (es: string) => string }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [chat.messages.length]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true); setError('');
    try { await chat.send(text); setText(''); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return <div className={styles.chat}>
    {chat.error && <p role="alert" className={styles.error}>{chat.error}</p>}
    {!chat.ready && !chat.error && <p role="status">{t('Abriendo el canal…')}</p>}
    <div className={styles.messages}>
      {chat.messages.map(m => <div key={m.id} className={`${styles.bubbleRow} ${m.senderId === myId ? styles.mine : ''}`}>
        <div className={styles.bubble}>
          {m.senderId !== myId && <strong className={styles.sender}>{m.senderName}</strong>}
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
  </div>;
}
