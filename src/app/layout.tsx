import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { BASE_PATH, IS_DEMO } from "@/shared/base";
import DemoBar from "@/demo/DemoBar";

export const metadata: Metadata = {
  title: "Sangam Seva · Maha Kumbh crowd management",
  description: "Pilgrim registration kiosk and control-room dashboard.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#b30083" };

// Applies the saved theme before paint, so there's no flash. Inline because it must run first.
const themeScript = `try{var t=localStorage.getItem('theme');if(!t){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}`;

// Demo build only: answer /api/* calls from the in-browser backend (see src/demo/backend.ts).
const demoBoot = `(function(){var B=${JSON.stringify(BASE_PATH)};window.__BASE_PATH__=B;var of=window.fetch.bind(window);var r;var ready=new Promise(function(x){r=x});window.__demoReady=function(api){r(api)};if(window.__demoApi)r(window.__demoApi);
window.fetch=function(input,init){try{var u=new URL(typeof input==='string'?input:(input instanceof URL?input.href:input.url),location.href);if(u.origin===location.origin){var p=u.pathname;if(p.indexOf(B+'/api/')===0||(B&&p.indexOf('/api/')===0)){var req=(typeof input==='string'||input instanceof URL)?new Request(B&&p.indexOf(B)!==0?location.origin+B+p+u.search:u.href,init):new Request(input,init);return ready.then(function(api){return api.handle(req)})}}}catch(e){}return of(input,init)}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Server deployments: the nonce from src/proxy.ts. The static demo build has no server and no nonce.
  const nonce = IS_DEMO ? undefined : ((await headers()).get("x-nonce") ?? undefined);
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
        {IS_DEMO && <script dangerouslySetInnerHTML={{ __html: demoBoot }} />}
        {IS_DEMO && <script type="module" src={`${BASE_PATH}/demo/backend.js`} />}
      </head>
      <body>
        <div className="aurora" aria-hidden="true">
          <span />
        </div>
        {IS_DEMO && <DemoBar />}
        {children}
      </body>
    </html>
  );
}
