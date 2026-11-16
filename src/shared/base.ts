/** URL prefix when the site is served from a sub-path (GitHub Pages: /Kumbh_Crowd_Management). Empty on a normal server. */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO === "1";
export const withBase = (p: string) => `${BASE_PATH}${p}`;
