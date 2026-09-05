"use client";
import { useEffect } from "react";

// Límite de errores de Next.js para esta ruta: si algo revienta al renderizar,
// muestra esto en vez de la pantalla genérica de Next, y deja el error en los
// logs del servidor (Vercel → Deployments → Runtime Logs) para poder
// diagnosticarlo, ya que Next oculta el mensaje real al navegador en producción.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div style={{ padding: "48px 24px", fontFamily: "Arial, Helvetica, sans-serif", color: "#4A1420", maxWidth: 560, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Algo salió mal</h1>
      <p style={{ color: "#6D6064" }}>Hubo un problema al cargar esta parte de la aplicación. Puedes intentar de nuevo; si sigue pasando, revisa los Runtime Logs en Vercel.</p>
      {error.digest && <p style={{ color: "#6D6064", fontSize: 13 }}>Código de referencia: {error.digest}</p>}
      <button onClick={() => reset()} style={{ marginTop: 16, padding: "12px 22px", background: "#6B1F2B", color: "white", border: 0, borderRadius: 8, cursor: "pointer", fontSize: 16 }}>Reintentar</button>
    </div>
  );
}
