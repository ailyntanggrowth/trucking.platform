'use server';
// El navegador nunca tiene la clave service-role, así que estas funciones
// reciben el access_token de la sesión del que llama y lo validan aquí mismo
// contra Supabase Auth (auth.getUser) antes de hacer nada. Las acciones que
// cambian permisos (invitar, cambiar rol, quitar acceso) además verifican que
// quien llama sea 'admin' — ver requireAdmin.
import { supabaseServer, DEFAULT_COMPANY_ID } from './supabase-server';
import type { Profile, Role } from './users';

async function callerId(accessToken: string): Promise<string> {
  const supabase = supabaseServer();
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) throw new Error('Sesión inválida o vencida. Vuelve a entrar.');
  return data.user.id;
}

function mapRow(r: Record<string, any>): Profile {
  return { id: r.id, email: r.email, name: r.name, role: r.role as Role };
}

export async function getMyProfile(accessToken: string): Promise<Profile | null> {
  const id = await callerId(accessToken);
  const supabase = supabaseServer();
  const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data) : null;
}

async function requireAdmin(accessToken: string): Promise<string> {
  const id = await callerId(accessToken);
  const supabase = supabaseServer();
  const { data, error } = await supabase.from('profiles').select('role').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.role !== 'admin') throw new Error('Solo un administrador puede hacer esto.');
  return id;
}

export async function listProfiles(accessToken: string, companyId = DEFAULT_COMPANY_ID): Promise<Profile[]> {
  await requireAdmin(accessToken);
  const supabase = supabaseServer();
  const { data, error } = await supabase.from('profiles').select('*').eq('company_id', companyId).order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

export async function inviteProfile(accessToken: string, email: string, name: string, role: Role, companyId = DEFAULT_COMPANY_ID): Promise<Profile> {
  await requireAdmin(accessToken);
  const cleanEmail = email.trim().toLocaleLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new Error('Revisa el correo electrónico.');
  if (!name.trim()) throw new Error('Escribe el nombre de la persona.');
  const supabase = supabaseServer();

  const { data: existing } = await supabase.from('profiles').select('id').eq('company_id', companyId).ilike('email', cleanEmail).maybeSingle();
  if (existing) throw new Error('Ese correo ya tiene una cuenta en el sistema.');

  const { data: invited, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(cleanEmail);
  let userId = invited?.user?.id;
  if (inviteError) {
    // Ya existe como usuario de Auth (p.ej. de otra compañía) — lo reutilizamos por correo.
    if (!inviteError.message.toLowerCase().includes('already been registered') && !inviteError.message.toLowerCase().includes('already registered')) throw new Error(inviteError.message);
    const { data: list, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) throw new Error(listError.message);
    userId = list.users.find(u => u.email?.toLocaleLowerCase() === cleanEmail)?.id;
    if (!userId) throw new Error('No se pudo invitar ni encontrar ese correo.');
  }

  const { data, error } = await supabase.from('profiles').insert({ id: userId, company_id: companyId, email: cleanEmail, name: name.trim(), role }).select('*').single();
  if (error) throw new Error(error.message);
  return mapRow(data);
}

export async function updateProfileRole(accessToken: string, targetId: string, role: Role): Promise<Profile> {
  await requireAdmin(accessToken);
  const supabase = supabaseServer();
  const { data, error } = await supabase.from('profiles').update({ role }).eq('id', targetId).select('*').single();
  if (error) throw new Error(error.message);
  return mapRow(data);
}

export async function removeProfile(accessToken: string, targetId: string): Promise<void> {
  const callerAdmin = await requireAdmin(accessToken);
  if (callerAdmin === targetId) throw new Error('No puedes quitarte el acceso a ti mismo.');
  const supabase = supabaseServer();
  const { error } = await supabase.from('profiles').delete().eq('id', targetId);
  if (error) throw new Error(error.message);
}
