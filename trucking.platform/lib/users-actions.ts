'use server';
// El navegador nunca tiene la clave service-role, así que estas funciones
// reciben el access_token de la sesión del que llama y lo validan aquí mismo
// contra Supabase Auth (auth.getUser) antes de hacer nada. Usuarios y Permisos
// es para 'owner' y 'admin' — la única protección es que un 'admin' no puede
// tocar la cuenta del 'owner' (cambiarle el rol, desactivarla ni borrarla).
import { supabaseServer, DEFAULT_COMPANY_ID } from './supabase-server';
import type { Profile, Role } from './users';

async function callerId(accessToken: string): Promise<string> {
  const supabase = supabaseServer();
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) throw new Error('Sesión inválida o vencida. Vuelve a entrar.');
  return data.user.id;
}

function mapRow(r: Record<string, any>, lastSignInAt: string | null = null): Profile {
  return { id: r.id, email: r.email, name: r.name, role: r.role as Role, active: r.active ?? true, lastSignInAt, driverId: r.driver_id ?? null };
}

async function requireManageUsers(accessToken: string): Promise<{ id: string; role: Role }> {
  const id = await callerId(accessToken);
  const supabase = supabaseServer();
  const { data, error } = await supabase.from('profiles').select('role').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || (data.role !== 'owner' && data.role !== 'admin')) throw new Error('No tienes permiso para administrar Usuarios y Permisos.');
  return { id, role: data.role as Role };
}

async function guardTargetNotOwner(supabase: ReturnType<typeof supabaseServer>, caller: { role: Role }, targetId: string) {
  if (caller.role === 'owner') return;
  const { data, error } = await supabase.from('profiles').select('role').eq('id', targetId).maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.role === 'owner') throw new Error('No puedes modificar esta cuenta.');
}

export async function getMyProfile(accessToken: string): Promise<Profile | null> {
  const id = await callerId(accessToken);
  const supabase = supabaseServer();
  const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data) : null;
}

// El "último acceso" y quién nunca ha entrado (invitación pendiente) salen
// del propio Supabase Auth (last_sign_in_at) — no se inventa ningún estado
// nuevo, solo se cruza con la lista de perfiles por id.
export async function listProfiles(accessToken: string, companyId = DEFAULT_COMPANY_ID): Promise<Profile[]> {
  await requireManageUsers(accessToken);
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

export type UnlinkedDriver = { id: string; name: string };
export async function listUnlinkedDrivers(accessToken: string, companyId = DEFAULT_COMPANY_ID): Promise<UnlinkedDriver[]> {
  await requireManageUsers(accessToken);
  const supabase = supabaseServer();
  const [{ data: drivers, error: dErr }, { data: linked, error: lErr }] = await Promise.all([
    supabase.from('drivers').select('id,name').eq('company_id', companyId).order('name', { ascending: true }),
    supabase.from('profiles').select('driver_id').eq('company_id', companyId).not('driver_id', 'is', null),
  ]);
  if (dErr) throw new Error(dErr.message);
  if (lErr) throw new Error(lErr.message);
  const linkedIds = new Set((linked ?? []).map(p => p.driver_id as string));
  return (drivers ?? []).filter(d => !linkedIds.has(d.id));
}

export async function inviteProfile(accessToken: string, email: string, name: string, role: Role, driverId: string | null = null, companyId = DEFAULT_COMPANY_ID): Promise<Profile> {
  await requireManageUsers(accessToken);
  const cleanEmail = email.trim().toLocaleLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new Error('Revisa el correo electrónico.');
  if (!name.trim()) throw new Error('Escribe el nombre de la persona.');
  if (role === 'driver' && !driverId) throw new Error('Elige a qué chofer de Choferes y Flota corresponde esta cuenta.');
  const supabase = supabaseServer();

  const { data: existing } = await supabase.from('profiles').select('id').eq('company_id', companyId).ilike('email', cleanEmail).maybeSingle();
  if (existing) throw new Error('Ese correo ya tiene una cuenta en el sistema.');

  if (role === 'driver' && driverId) {
    const { data: alreadyLinked } = await supabase.from('profiles').select('id').eq('driver_id', driverId).maybeSingle();
    if (alreadyLinked) throw new Error('Ese chofer ya tiene una cuenta de acceso.');
  }

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

  const { data, error } = await supabase.from('profiles').insert({ id: userId, company_id: companyId, email: cleanEmail, name: name.trim(), role, driver_id: role === 'driver' ? driverId : null }).select('*').single();
  if (error) throw new Error(error.message);

  // Grupo privado automático del chofer: él + todo el staff con acceso a
  // choferes (dueño, administrador, dispatcher) al momento de crear la
  // cuenta — spec: "Dixon Escabi" solo lo ve Dixon, Gleiby, Ailyn y Mario.
  if (role === 'driver') {
    const { data: staff } = await supabase.from('profiles').select('id').eq('company_id', companyId).in('role', ['owner', 'admin', 'dispatcher']);
    const memberIds = Array.from(new Set([data.id, ...(staff ?? []).map(p => p.id as string)]));
    const { data: conv, error: convErr } = await supabase.from('conversations').insert({ company_id: companyId, name: name.trim(), is_group: true, created_by: data.id }).select('id').single();
    if (!convErr && conv) {
      await supabase.from('conversation_members').insert(memberIds.map(id => ({ conversation_id: conv.id, profile_id: id })));
    }
  }

  return mapRow(data);
}

export async function updateProfileRole(accessToken: string, targetId: string, role: Role): Promise<Profile> {
  const caller = await requireManageUsers(accessToken);
  if (caller.id === targetId) throw new Error('No puedes cambiar tu propio rol. Pídeselo a otro administrador.');
  const supabase = supabaseServer();
  await guardTargetNotOwner(supabase, caller, targetId);
  const { data, error } = await supabase.from('profiles').update({ role }).eq('id', targetId).select('*').single();
  if (error) throw new Error(error.message);
  return mapRow(data);
}

export async function setProfileActive(accessToken: string, targetId: string, active: boolean): Promise<Profile> {
  const caller = await requireManageUsers(accessToken);
  if (caller.id === targetId) throw new Error('No puedes desactivar tu propia cuenta.');
  const supabase = supabaseServer();
  await guardTargetNotOwner(supabase, caller, targetId);
  const { data, error } = await supabase.from('profiles').update({ active }).eq('id', targetId).select('*').single();
  if (error) throw new Error(error.message);
  return mapRow(data);
}

export async function removeProfile(accessToken: string, targetId: string): Promise<void> {
  const caller = await requireManageUsers(accessToken);
  if (caller.id === targetId) throw new Error('No puedes quitarte el acceso a ti mismo.');
  const supabase = supabaseServer();
  await guardTargetNotOwner(supabase, caller, targetId);
  const { error } = await supabase.from('profiles').delete().eq('id', targetId);
  if (error) throw new Error(error.message);
}
