'use server';
// Igual que en users-actions.ts: el navegador nunca tiene la clave service-role,
// así que estas funciones reciben el access_token de la sesión y lo validan aquí
// (auth.getUser) antes de leer o escribir nada. Cualquier persona con perfil en
// la compañía puede ver la lista de compañeros y empezar una conversación, pero
// solo puede leer/escribir en conversaciones de las que ya es miembro.
import { supabaseServer, DEFAULT_COMPANY_ID } from './supabase-server';
import type { Conversation, Message, ChatContact } from './chat';

async function callerProfile(accessToken: string, companyId: string) {
  const supabase = supabaseServer();
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) throw new Error('Sesión inválida o vencida. Vuelve a entrar.');
  const { data: profile, error: profileError } = await supabase.from('profiles').select('id,name').eq('id', userData.user.id).eq('company_id', companyId).maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile) throw new Error('Tu cuenta no tiene acceso al chat.');
  return profile as { id: string; name: string };
}

function mapMessage(r: Record<string, any>): Message {
  return { id: r.id, conversationId: r.conversation_id, senderId: r.sender_id, senderName: r.sender_name, body: r.body, createdAt: r.created_at };
}

async function requireMember(supabase: ReturnType<typeof supabaseServer>, conversationId: string, profileId: string) {
  const { data, error } = await supabase.from('conversation_members').select('profile_id').eq('conversation_id', conversationId).eq('profile_id', profileId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('No tienes acceso a esta conversación.');
}

export async function listContacts(accessToken: string, companyId = DEFAULT_COMPANY_ID): Promise<ChatContact[]> {
  const me = await callerProfile(accessToken, companyId);
  const supabase = supabaseServer();
  const { data, error } = await supabase.from('profiles').select('id,name').eq('company_id', companyId).neq('id', me.id).order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listConversations(accessToken: string, companyId = DEFAULT_COMPANY_ID): Promise<Conversation[]> {
  const me = await callerProfile(accessToken, companyId);
  const supabase = supabaseServer();
  const { data: myMemberships, error: mErr } = await supabase.from('conversation_members').select('conversation_id,last_read_at').eq('profile_id', me.id);
  if (mErr) throw new Error(mErr.message);
  const convIds = (myMemberships ?? []).map(m => m.conversation_id);
  if (!convIds.length) return [];
  const lastReadByConv = new Map((myMemberships ?? []).map(m => [m.conversation_id, m.last_read_at as string]));

  const [{ data: convs, error: cErr }, { data: allMembers, error: amErr }, { data: msgAgg, error: msgErr }] = await Promise.all([
    supabase.from('conversations').select('*').in('id', convIds),
    supabase.from('conversation_members').select('conversation_id,profile_id,profiles(name)').in('conversation_id', convIds),
    supabase.from('messages').select('conversation_id,body,sender_name,sender_id,created_at').in('conversation_id', convIds).order('created_at', { ascending: false }),
  ]);
  if (cErr) throw new Error(cErr.message);
  if (amErr) throw new Error(amErr.message);
  if (msgErr) throw new Error(msgErr.message);

  const lastByConv = new Map<string, { body: string; senderName: string; senderId: string; createdAt: string }>();
  const unreadByConv = new Map<string, number>();
  for (const m of msgAgg ?? []) {
    if (!lastByConv.has(m.conversation_id)) lastByConv.set(m.conversation_id, { body: m.body, senderName: m.sender_name, senderId: m.sender_id, createdAt: m.created_at });
    const lastRead = lastReadByConv.get(m.conversation_id) || '1970-01-01T00:00:00Z';
    if (m.sender_id !== me.id && m.created_at > lastRead) unreadByConv.set(m.conversation_id, (unreadByConv.get(m.conversation_id) || 0) + 1);
  }

  const membersByConv = new Map<string, { id: string; name: string }[]>();
  for (const row of (allMembers ?? []) as any[]) {
    const list = membersByConv.get(row.conversation_id) || [];
    list.push({ id: row.profile_id, name: row.profiles?.name || '' });
    membersByConv.set(row.conversation_id, list);
  }

  return (convs ?? []).map(c => {
    const members = membersByConv.get(c.id) || [];
    const others = members.filter(m => m.id !== me.id);
    const displayName = c.name || others.map(o => o.name).join(', ') || me.name;
    return {
      id: c.id as string, name: displayName, isGroup: c.is_group as boolean,
      memberIds: members.map(m => m.id), memberNames: members.map(m => m.name),
      lastMessage: lastByConv.get(c.id) || null,
      unreadCount: unreadByConv.get(c.id) || 0,
    };
  }).sort((a, b) => (b.lastMessage?.createdAt || '').localeCompare(a.lastMessage?.createdAt || ''));
}

export async function listMessages(accessToken: string, conversationId: string, companyId = DEFAULT_COMPANY_ID): Promise<Message[]> {
  const me = await callerProfile(accessToken, companyId);
  const supabase = supabaseServer();
  await requireMember(supabase, conversationId, me.id);
  const { data, error } = await supabase.from('messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: true }).limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapMessage);
}

export async function sendMessage(accessToken: string, conversationId: string, body: string, companyId = DEFAULT_COMPANY_ID): Promise<Message> {
  const me = await callerProfile(accessToken, companyId);
  const text = body.trim();
  if (!text) throw new Error('Escribe algo antes de enviar.');
  if (text.length > 4000) throw new Error('El mensaje es demasiado largo.');
  const supabase = supabaseServer();
  await requireMember(supabase, conversationId, me.id);
  const { data, error } = await supabase.from('messages').insert({ company_id: companyId, conversation_id: conversationId, sender_id: me.id, sender_name: me.name, body: text }).select('*').single();
  if (error) throw new Error(error.message);
  await supabase.from('conversation_members').update({ last_read_at: data.created_at }).eq('conversation_id', conversationId).eq('profile_id', me.id);
  return mapMessage(data);
}

export async function markConversationRead(accessToken: string, conversationId: string, companyId = DEFAULT_COMPANY_ID): Promise<void> {
  const me = await callerProfile(accessToken, companyId);
  const supabase = supabaseServer();
  await requireMember(supabase, conversationId, me.id);
  const { error } = await supabase.from('conversation_members').update({ last_read_at: new Date().toISOString() }).eq('conversation_id', conversationId).eq('profile_id', me.id);
  if (error) throw new Error(error.message);
}

export async function createConversation(accessToken: string, memberIds: string[], name: string, companyId = DEFAULT_COMPANY_ID): Promise<Conversation> {
  const me = await callerProfile(accessToken, companyId);
  const uniqueOthers = Array.from(new Set(memberIds.filter(id => id !== me.id)));
  if (!uniqueOthers.length) throw new Error('Elige al menos una persona.');
  const isGroup = uniqueOthers.length > 1 || Boolean(name.trim());
  const supabase = supabaseServer();

  if (!isGroup) {
    // Reusa la conversación 1 a 1 si ya existe entre estas dos personas —
    // nunca crea un duplicado por darle "Nueva conversación" dos veces.
    const otherId = uniqueOthers[0];
    const [{ data: mine }, { data: theirs }] = await Promise.all([
      supabase.from('conversation_members').select('conversation_id').eq('profile_id', me.id),
      supabase.from('conversation_members').select('conversation_id').eq('profile_id', otherId),
    ]);
    const sharedIds = (mine ?? []).map(m => m.conversation_id).filter(id => (theirs ?? []).some(t => t.conversation_id === id));
    if (sharedIds.length) {
      const { data: existingConvs } = await supabase.from('conversations').select('id').in('id', sharedIds).eq('is_group', false);
      if (existingConvs && existingConvs.length) {
        const list = await listConversations(accessToken, companyId);
        const found = list.find(c => c.id === existingConvs[0].id);
        if (found) return found;
      }
    }
  }

  const { data: conv, error: convErr } = await supabase.from('conversations').insert({ company_id: companyId, name: isGroup ? (name.trim() || null) : null, is_group: isGroup, created_by: me.id }).select('*').single();
  if (convErr) throw new Error(convErr.message);
  const memberRows = [me.id, ...uniqueOthers].map(id => ({ conversation_id: conv.id, profile_id: id }));
  const { error: memErr } = await supabase.from('conversation_members').insert(memberRows);
  if (memErr) throw new Error(memErr.message);

  const list = await listConversations(accessToken, companyId);
  return list.find(c => c.id === conv.id)!;
}
