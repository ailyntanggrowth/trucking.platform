// Supabase corta cualquier consulta en 1,000 filas, sin avisar. Bug real
// (23 nov): al importar el statement de Mudflap la tabla de combustible pasó
// de 1,000 filas (1,097) y la app dejó de ver las más nuevas — el resumen
// mostraba "Dixon $389", "Total sin descuento $3,480" aunque la base tenía
// todo bien guardado. Toda lectura de una tabla que crece (combustible,
// eventos, cargas) debe pasar por aquí: pide de 1,000 en 1,000 hasta que no
// quede nada. La consulta DEBE tener un orden estable (por eso cada llamada
// ordena por una columna única) o las páginas pueden repetir/saltarse filas.
const PAGE = 1000;

type Page<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAllRows<T = Record<string, any>>(page: (from: number, to: number) => PromiseLike<Page<T>>): Promise<Page<T>> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { data: null, error };
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return { data: all, error: null };
}
