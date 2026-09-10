// pdfjs-dist (usado en lib/summar-actions.ts para leer statements de
// Summar) es una librería pensada para navegador con requires internos
// dinámicos que el empaquetado normal de webpack de Next.js no maneja bien
// dentro de una Server Action — funcionaba perfecto en local (Node puro,
// sin empaquetar) pero fallaba en producción en Vercel con un error
// genérico de "Server Components render". Marcarla como paquete externo le
// dice a Next que la cargue tal cual desde node_modules en vez de
// empaquetarla, que es la forma documentada de usar este tipo de librería
// en Server Components/Actions.
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['pdfjs-dist'],
  },
};

export default nextConfig;
