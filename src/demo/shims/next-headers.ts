import { requestCookies } from "../context";

/** Browser stand-in for `next/headers`. */
export async function cookies() {
  const jar = requestCookies();
  return {
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    has: (name: string) => jar.has(name),
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
  };
}

export async function headers() {
  return new Headers();
}
