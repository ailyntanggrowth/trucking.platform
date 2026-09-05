// Uso único (y reutilizable para futuros respaldos): sube los ARCHIVOS de un
// respaldo exportado con el botón "Exportar respaldo" a Supabase Storage.
//
// No toca ninguna tabla — eso lo hace el script SQL de importación (generado
// aparte, a partir del mismo respaldo, y aplicado vía SQL Editor). Este script
// solo necesita la clave service-role porque solo ella puede escribir en Storage.
//
// Uso:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/import-fleet-documents.mjs <carpeta-con-los-archivos-descargados> <company-id>
//
// Cada archivo descargado por el botón de exportar se llama "<documentId>__<nombre-original>".
// Este script sube cada uno a fleet-documents/<companyId>/<documentId>/<nombre-original>,
// exactamente la ruta que el script SQL de importación habrá guardado en storage_path.

import { createClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , folder, companyId] = process.argv;
if (!folder || !companyId) {
  console.error('Uso: node scripts/import-fleet-documents.mjs <carpeta> <company-id>');
  process.exit(1);
}
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno.');
  process.exit(1);
}

const supabase = createClient(url, key);

for (const filename of readdirSync(folder)) {
  const separator = filename.indexOf('__');
  if (separator === -1) { console.warn(`Omitido (nombre inesperado): ${filename}`); continue; }
  const documentId = filename.slice(0, separator);
  const originalName = filename.slice(separator + 2);
  const path = `${companyId}/${documentId}/${originalName}`;
  const bytes = readFileSync(join(folder, filename));
  const { error } = await supabase.storage.from('fleet-documents').upload(path, bytes, { upsert: true });
  if (error) console.error(`Error subiendo ${filename} -> ${path}:`, error.message);
  else console.log(`OK: ${filename} -> ${path}`);
}
