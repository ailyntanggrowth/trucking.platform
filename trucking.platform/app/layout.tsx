import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "M&A King Truck Service",
  description: "Centro de operaciones para la gestión de flota y transporte.",
  // Para que "Añadir a pantalla de inicio" en iPhone abra la app como app
  // completa (sin la barra de Safari) en vez de una pestaña normal — sin
  // esto, iOS a veces trata cada apertura del ícono más como una pestaña
  // nueva de Safari que como la misma app, lo cual también afecta si la
  // sesión guardada se reconoce al volver a abrir.
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'M&A King' },
};

export const viewport: Viewport = {
  themeColor: '#8B102A',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
