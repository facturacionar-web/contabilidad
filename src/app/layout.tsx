import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alegrant",
  description: "Gestión de ingresos, gastos, contactos y reportes",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Aplica el tema antes de pintar para evitar flash
  const themeScript = `
    (function() {
      try {
        var t = localStorage.getItem('alegrant.theme');
        if (!t) {
          t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        if (t === 'dark') document.documentElement.classList.add('dark');
      } catch(e) {}
    })();
  `;

  return (
    <html lang="es" className="h-full antialiased">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
