import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sangam Seva · Maha Kumbh crowd management",
  description: "Pilgrim registration kiosk and control-room dashboard.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#b30083" };

// Applies the saved theme before paint, so there's no flash. Inline because it must run first.
const themeScript = `try{var t=localStorage.getItem('theme');if(!t){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <div className="aurora" aria-hidden="true">
          <span />
        </div>
        {children}
      </body>
    </html>
  );
}
