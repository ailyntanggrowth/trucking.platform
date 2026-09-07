"use client";
import { useCallback, useEffect, useState } from 'react';
import { listMessages, sendMessage as sendMessageAction } from './chat-actions';
import type { Message } from './chat';

// Sin Supabase Realtime todavía — se aproxima "tiempo real" con un refresh
// cada 5s mientras el módulo está abierto, más refresh al volver a la pestaña
// (mismo patrón que el resto de la app, pero con un intervalo además, porque
// acá sí importa ver lo que escriben otras personas sin recargar a mano).
export function useChat(getAccessToken: () => Promise<string>) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const token = await getAccessToken();
      const next = await listMessages(token);
      setMessages(next);
      setReady(true);
      setError('');
    } catch (e) { setError((e as Error).message); }
  }, [getAccessToken]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 5000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => { clearInterval(interval); window.removeEventListener('focus', focus); };
  }, [refresh]);

  async function send(body: string) {
    const token = await getAccessToken();
    const message = await sendMessageAction(token, body);
    setMessages(prev => [...prev, message]);
    return message;
  }

  return { messages, ready, error, refresh, send };
}
export type ChatController = ReturnType<typeof useChat>;
