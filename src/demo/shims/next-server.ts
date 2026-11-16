/** Browser stand-in for `next/server`: a Response that records cookies set by route handlers. */
export type CookieSet = { name: string; value: string; maxAge?: number; [k: string]: unknown };

export class NextResponse extends Response {
  readonly setCookies: CookieSet[] = [];
  readonly cookies = {
    set: (a: string | CookieSet, b?: string, c?: Record<string, unknown>) => {
      this.setCookies.push(typeof a === "string" ? { name: a, value: b ?? "", ...(c ?? {}) } : a);
    },
    delete: (name: string) => {
      this.setCookies.push({ name, value: "", maxAge: 0 });
    },
  };

  static json(data: unknown, init?: ResponseInit) {
    const headers = new Headers(init?.headers);
    headers.set("content-type", "application/json");
    return new NextResponse(JSON.stringify(data), { ...init, headers });
  }

  static redirect(url: string | URL, status = 307) {
    return new NextResponse(null, { status, headers: { location: String(url) } });
  }

  static next() {
    return new NextResponse(null);
  }
}

export type NextRequest = Request;
