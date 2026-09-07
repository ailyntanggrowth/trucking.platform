// Módulo 8 (Usuarios y Permisos). 'owner' ve y hace todo, y es el ÚNICO que
// puede entrar a Usuarios y Permisos (agregar/quitar personas, cambiar
// roles, activar/desactivar); el resto de roles reparten el acceso al resto
// de módulos — ver moduleAccessByRole en app/page.tsx. No hay contraseñas —
// el login es por link mágico de correo (Supabase Auth).
export type Role = 'owner' | 'admin' | 'contabilidad' | 'gerente' | 'dispatcher' | 'consulta';
export const ROLE_VALUES: Role[] = ['owner', 'admin', 'contabilidad', 'gerente', 'dispatcher', 'consulta'];
export const roleLabel = (role: Role) => ({
  owner: 'Dueño', admin: 'Administrador', contabilidad: 'Contabilidad', gerente: 'Gerente', dispatcher: 'Dispatcher', consulta: 'Consulta',
}[role]);
export const roleDescription = (role: Role) => ({
  owner: 'Control total, incluyendo Usuarios y Permisos',
  admin: 'Acceso a todo el sistema, excepto Usuarios y Permisos',
  contabilidad: 'Cargas, Combustible, Contabilidad y Reportes',
  gerente: 'Cargas, Combustible, Reportes y Chat — sin Contabilidad',
  dispatcher: 'Solo Cargas y Chat',
  consulta: 'Solo lectura: Cargas y Reportes',
}[role]);
export const roleTone = (role: Role) => ({
  owner: '#8B102A', admin: '#8B102A', contabilidad: '#8a5a00', gerente: '#59616D', dispatcher: '#1e4e8c', consulta: '#1f7a4d',
}[role]);
export type Profile = { id: string; email: string; name: string; role: Role; active: boolean; lastSignInAt: string | null };
