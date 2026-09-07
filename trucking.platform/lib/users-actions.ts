'use server';
// El navegador nunca tiene la clave service-role, así que estas funciones
// reciben el access_token de la sesión del que llama y lo validan aquí mismo
// contra Supabase Auth (auth.getUser) antes de hacer nada. Usuarios y Permisos
// es SOLO para 'owner' — ni siquiera 'admin' puede ver ni tocar esto, pedido
// explícito de la dueña — ver requireOwner.
import { supabaseServer, DEFAULT_COMPANY_ID } from './supabase-server';
import type { Profile, Role } from './users';

async function callerId(accessToken: string): Promise<string> {
  const supabase = supabaseServer();
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) throw new Error('Sesión inválida o vencida. Vuelve a entrar.');
  return data.user.id;
}

function mapRow(r: Record<string, any>, lastSignInAt: string | null = null): Profile {
  return { id: r.id, email: r.email, name: r.name, role: r.role as Role, active: r.active ?? true, lastSignInAt };
}

export async function getMyProfile(accessToken: string): Promise<Profile | null> {
  const id = await callerId(accessToken);
  const supabase = supabaseServer();
  const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data) : null;
}

async function requireOwner(accessToken: string): Promise<string> {
  const id = await callerId(accessToken);
  const supabase = supabaseServer();
  const { data, error } = await supabase.from('profiles').select('role').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.role !== 'owner') throw new Error('Solo el dueño de la cuenta puede hacer esto.');
  return id;
}

// El "último acceso" y quién nunca ha entrado (invitación pendiente) salen
// del propio Supabase Auth (last_sign_in_at) — no se inventa ningún estado
// nuevo, solo se cruza con la lista de perfiles por id.
export async function listProfiles(accessToken: string, companyId = DEFAULT_COMPANY_ID): Promise<Profile[]> {
  await requireOwner(accessToken);
  const supabase = supabaseServer();
  const [{ data, error }, { data: authList, error: authError }] = await Promise.all([
    supabase.from('profiles').select('*').eq('company_id', companyId).order('created_at', { ascending: true }),
    supabase.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  if (error) throw new Error(error.message);
  if (authError) throw new Error(authError.message);
  const lastSignInById = new Map((authList?.users ?? []).map(u => [u.id, u.last_sign_in_at ?? null]));
  return (data ?? []).map(r => mapRow(r, lastSignInById.get(r.id) ?? null));
}

export async function inviteProfile(accessToken: string, email: string, name: string, role: Role, companyId = DEFAULT_COMPANY_ID): Promise<Profile> {
  await requireOwner(accessToken);
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
  const callerId = await requireOwner(accessToken);
  if (callerId === targetId) throw new Error('No puedes cambiar tu propio rol. Pídeselo a otro dueño.');
  const supabase = supabaseServer();
  const { data, error } = await supabase.from('profiles').update({ role }).eq('id', targetId).select('*').single();
  if (error) throw new Error(error.message);
  return mapRow(data);
}

export async function setProfileActive(accessToken: string, targetId: string, active: boolean): Promise<Profile> {
  const callerId = await requireOwner(accessToken);
  if (callerId === targetId) throw new Error('No puedes desactivar tu propia cuenta.');
  const supabase = supabaseServer();
  const { data, error } = await supabase.from('profiles').update({ active }).eq('id', targetId).select('*').single();
  if (error) throw new Error(error.message);
  return mapRow(data);
}

export async function removeProfile(accessToken: string, targetId: string): Promise<void> {
  const callerId = await requireOwner(accessToken);
  if (callerId === targetId) throw new Error('No puedes quitarte el acceso a ti mismo.');
  const supabase = supabaseServer();
  const { error } = await supabase.from('profiles').delete().eq('id', targetId);
  if (error) throw new Error(error.message);
}
