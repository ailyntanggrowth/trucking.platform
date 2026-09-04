import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "M&A King Truck Service",
  description: "Centro de operaciones para la gestión de flota y transporte.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
