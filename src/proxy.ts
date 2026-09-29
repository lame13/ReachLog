import { NextRequest, NextResponse } from "next/server";

const REALM = "ReachLog";

// Block writes to the shared demo database, including POST-based server actions.
const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function demoReadOnly(request: NextRequest): NextResponse | null {
  if (process.env.DEMO_MODE !== "true") {
    return null;
  }
  if (READ_ONLY_METHODS.has(request.method.toUpperCase())) {
    return null;
  }
  return new NextResponse(
    "This is a read-only demo of ReachLog. Nothing can be added, changed, imported or sent here.",
    {
      status: 403,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store"
      }
    }
  );
}

export function proxy(request: NextRequest) {
  const refused = demoReadOnly(request);
  if (refused) {
    return refused;
  }

  if (process.env.APP_BASIC_AUTH_ENABLED !== "true") {
    return NextResponse.next();
  }

  const expectedUser = process.env.APP_BASIC_AUTH_USER;
  const expectedPassword = process.env.APP_BASIC_AUTH_PASSWORD;

  if (!expectedUser || !expectedPassword) {
    return new NextResponse("Basic auth is enabled but credentials are missing.", {
      status: 503,
      headers: {
        "cache-control": "no-store"
      }
    });
  }

  const header = request.headers.get("authorization");
  const credentials = parseBasicAuth(header);

  if (
    credentials &&
    credentials.username === expectedUser &&
    credentials.password === expectedPassword
  ) {
    return NextResponse.next();
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "www-authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
      "cache-control": "no-store"
    }
  });
}

function parseBasicAuth(header: string | null) {
  if (!header?.startsWith("Basic ")) {
    return null;
  }

  try {
    const decoded = atob(header.slice("Basic ".length));
    const separator = decoded.indexOf(":");

    if (separator < 0) {
      return null;
    }

    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1)
    };
  } catch {
    return null;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"]
};
