"use client";
import { useEffect, useState } from "react";

/** Shown on every page of the demo build so nobody mistakes demo data for live data. */
export default function DemoBar() {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    const w = window as unknown as { __demoApi?: unknown };
    if (w.__demoApi) setState("ready");
    const t = setInterval(() => w.__demoApi && setState("ready"), 300);
    const onErr = (e: Event) => { setState("error"); setMsg((e as CustomEvent).detail); };
    document.addEventListener("demo-backend-error", onErr);
    return () => { clearInterval(t); document.removeEventListener("demo-backend-error", onErr); };
  }, []);
  const reset = async () => {
    if (!confirm("Reset the demo? This clears all demo data in this browser and starts fresh.")) return;
    const api = (window as unknown as { __demoApi?: { reset: () => Promise<void> } }).__demoApi;
    await api?.reset();
    location.reload();
  };
  return (
    <div className="demo-bar" role="status">
      <span className="icon" style={{ fontSize: 14 }}>science</span>
      <span>
        <b>Demo</b><span className="long"> · runs entirely in this browser · invented data, simulated sensors</span>{state === "loading" ? " · starting…" : ""}
        {state === "error" ? ` · the demo database couldn't start (${msg}). Try another browser.` : ""}
      </span>
      <button onClick={reset}>Reset demo</button>
    </div>
  );
}
