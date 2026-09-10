// Cambio puramente de diagnóstico (pedido explícito, para ver el error real
// de "Subir Summar" en Safari/iPhone en vez del mensaje recortado que da
// Next.js en producción): activa los mapas de código fuente del lado del
// cliente. No cambia ningún comportamiento ni diseño de la app.
/** @type {import('next').NextConfig} */
const nextConfig = {
  productionBrowserSourceMaps: true,
};

export default nextConfig;
