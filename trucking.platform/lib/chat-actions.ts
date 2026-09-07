'use server';
// Igual que en users-actions.ts: el navegador nunca tiene la clave service-role,
// así que estas funciones reciben el access_token de la sesión y lo validan aquí
// (auth.getUser) antes de leer o escribir nada. Cualquier persona con perfil en
// la compañía (owner/admin/dispatcher) puede leer y escribir en el canal general.
import { supabaseServer, DEFAULT_COMPANY_ID } from './supabase-server';
import type { Message } from './chat';

async function callerProfile(accessToken: string, companyId: string) {
  const supabase = supabaseServer();
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) throw new Error('Sesión inválida o vencida. Vuelve a entrar.');
  const { data: profile, error: profileError } = await supabase.from('profiles').select('id,name').eq('id', userData.user.id).eq('company_id', companyId).maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile) throw new Error('Tu cuenta no tiene acceso a este canal.');
  return profile as { id: string; name: string };
}

function mapRow(r: Record<string, any>): Message {
  return { id: r.id, senderId: r.sender_id, senderName: r.sender_name, body: r.body, createdAt: r.created_at };
}

export async function listMessages(accessToken: string, companyId = DEFAULT_COMPANY_ID): Promise<Message[]> {
  await callerProfile(accessToken, companyId);
  const supabase = supabaseServer();
  const { data, error } = await supabase.from('messages').select('*').eq('company_id', companyId).order('created_at', { ascending: true }).limit(300);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

export async function sendMessage(accessToken: string, body: string, companyId = DEFAULT_COMPANY_ID): Promise<Message> {
  const profile = await callerProfile(accessToken, companyId);
  const text = body.trim();
  if (!text) throw new Error('Escribe algo antes de enviar.');
  if (text.length > 4000) throw new Error('El mensaje es demasiado largo.');
  const supabase = supabaseServer();
  const { data, error } = await supabase.from('messages').insert({ company_id: companyId, sender_id: profile.id, sender_name: profile.name, body: text }).select('*').single();
  if (error) throw new Error(error.message);
  return mapRow(data);
}
