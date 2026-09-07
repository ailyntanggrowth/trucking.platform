"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listConversations as listConversationsAction, listContacts as listContactsAction,
  listMessages as listMessagesAction, sendMessage as sendMessageAction,
  markConversationRead as markReadAction, createConversation as createConversationAction,
} from './chat-actions';
import type { Conversation, Message, ChatContact } from './chat';

// Sin Supabase Realtime todavía — se aproxima "tiempo real" con un refresh
// cada 5s mientras el módulo está abierto (lista de conversaciones + la
// conversación activa), más refresh al volver a la pestaña.
export function useChat(getAccessToken: () => Promise<string>) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const activeIdRef = useRef<string | null>(null);
  const setActiveId = (id: string | null) => { activeIdRef.current = id; setActiveIdState(id); };

  const refreshMessages = useCallback(async (conversationId: string) => {
    try {
      const token = await getAccessToken();
      const [msgs] = await Promise.all([listMessagesAction(token, conversationId), markReadAction(token, conversationId)]);
      if (activeIdRef.current === conversationId) setMessages(msgs);
      setConversations(prev => prev.map(c => c.id === conversationId ? { ...c, unreadCount: 0 } : c));
    } catch (e) { setError((e as Error).message); }
  }, [getAccessToken]);

  const refreshConversations = useCallback(async () => {
    try {
      const token = await getAccessToken();
      const list = await listConversationsAction(token);
      setConversations(list);
      setReady(true); setError('');
      if (!activeIdRef.current && list.length) { setActiveId(list[0].id); void refreshMessages(list[0].id); }
    } catch (e) { setError((e as Error).message); }
  }, [getAccessToken, refreshMessages]);

  useEffect(() => {
    void refreshConversations();
    void (async () => {
      try { const token = await getAccessToken(); setContacts(await listContactsAction(token)); }
      catch { /* la lista de contactos para "nueva conversación" no es crítica para ver el chat */ }
    })();
    const interval = setInterval(() => {
      void refreshConversations();
      if (activeIdRef.current) void refreshMessages(activeIdRef.current);
    }, 5000);
    const focus = () => { void refreshConversations(); if (activeIdRef.current) void refreshMessages(activeIdRef.current); };
    window.addEventListener('focus', focus);
    return () => { clearInterval(interval); window.removeEventListener('focus', focus); };
  }, [refreshConversations, refreshMessages, getAccessToken]);

  function openConversation(id: string) { setActiveId(id); setMessages([]); void refreshMessages(id); }

  async function send(body: string) {
    if (!activeIdRef.current) throw new Error('Elige una conversación primero.');
    const token = await getAccessToken();
    const message = await sendMessageAction(token, activeIdRef.current, body);
    setMessages(prev => [...prev, message]);
    void refreshConversations();
    return message;
  }

  async function startConversation(memberIds: string[], name: string) {
    const token = await getAccessToken();
    const conv = await createConversationAction(token, memberIds, name);
    await refreshConversations();
    openConversation(conv.id);
    return conv;
  }

  return { conversations, contacts, activeId, messages, ready, error, openConversation, send, startConversation, refresh: refreshConversations };
}
export type ChatController = ReturnType<typeof useChat>;
