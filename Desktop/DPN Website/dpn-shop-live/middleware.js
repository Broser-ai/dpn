const PROTECTED_PREFIXES = [
  "/harness-control",
  "/harness-control.html",
  "/harness-marketing",
  "/harness-marketing.html",
  "/harness-agents",
  "/harness-agents.html",
  "/harness-configurator",
  "/harness-configurator.html",
  "/api/harness"
];

function isProtectedPath(pathname) {
  return PROTECTED_PREFIXES.some((prefix) => {
    if (pathname === prefix) return true;
    return pathname.startsWith(prefix + "/");
  });
}

function unauthorized() {
  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="DPN Admin"',
      "Cache-Control": "no-store"
    }
  });
}

export default function middleware(request) {
  const url = new URL(request.url);
  if (!isProtectedPath(url.pathname)) return;

  const expectedUser = process.env.DPN_ADMIN_USER || "admin";
  const expectedPass = process.env.DPN_ADMIN_PASS || process.env.DPN_ADMIN_KEY;

  // If no password is configured, deny access.
  if (!expectedPass) return unauthorized();

  // Support key-based auth for automation: x-admin-key: <DPN_ADMIN_KEY>
  const keyHeader = request.headers.get("x-admin-key") || "";
  if (keyHeader && keyHeader === expectedPass) return;

  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Basic ")) {
    return unauthorized();
  }

  let providedUser = "";
  let providedPass = "";
  try {
    const decoded = atob(authHeader.slice(6));
    const separator = decoded.indexOf(":");
    if (separator === -1) return unauthorized();
    providedUser = decoded.slice(0, separator);
    providedPass = decoded.slice(separator + 1);
  } catch {
    return unauthorized();
  }

  if (providedUser !== expectedUser || providedPass !== expectedPass) {
    return unauthorized();
  }
}
