const redacted = "[REDACTED]";
const minimumDynamicSecretLength = 8;

const sensitiveQueryKeys = new Set([
  "access_token",
  "api_key",
  "auth",
  "authorization",
  "bearer",
  "id_token",
  "password",
  "secret",
  "session",
  "sessionid",
  "token"
]);

export type Redactor = {
  addSecret(secret: string | null | undefined): void;
  redactText(value: string): string;
  redactObject<T>(value: T): T;
  redactBuffer(body: Buffer, contentType: string | null | undefined): Buffer;
};

export function redactText(value: string): string {
  return createRedactor().redactText(value);
}

export function redactObject<T>(value: T): T {
  return createRedactor().redactObject(value);
}

export function createRedactor(initialSecrets: string[] = []): Redactor {
  const secrets = new Set<string>();
  const addSecret = (secret: string | null | undefined) => {
    // Blanket substring replacement is only safe for token-like values. A common
    // preference cookie such as "1" would otherwise corrupt timestamps, counts,
    // paths, and captured source throughout the haul. Credential-bearing headers,
    // URLs, password fields, and storage syntax are still redacted structurally.
    if (secret && secret.length >= minimumDynamicSecretLength) {
      secrets.add(secret);
    }
  };
  for (const secret of initialSecrets) {
    addSecret(secret);
  }

  const api: Redactor = {
    addSecret,
    redactText(value) {
      let output = value.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (match) => redactUrl(match));

      output = output
        // Real Authorization headers occupy a whole line; anchoring to line start
        // covers any scheme (Bearer, Basic, token, GenieKey, raw key) without
        // matching an "Authorization" mention embedded mid-line in captured code.
        .replace(/((?:^|[\r\n])[ \t]*Authorization\s*[:=]\s*)(?:[A-Za-z][\w-]*[ \t]+)?[^\r\n]+/gi, `$1${redacted}`)
        .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${redacted}`)
        .replace(/(\b(?:Cookie|Set-Cookie)\s*:\s*)[^\r\n]+/gi, `$1${redacted}`)
        .replace(/(\bpassword\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s&,;"'\n]+)/gi, `$1${redacted}`)
        .replace(/(\b(?:localStorage|sessionStorage)\.setItem\(\s*["'][^"']+["']\s*,\s*)(["'])[^"']*(\2\s*\))/gi, `$1$2${redacted}$3`)
        .replace(/(\blocalStorage\b(?:\s*\.\s*[\w$]+|\s*\[\s*(?:"[^"]*"|'[^']*')\s*\]|\s+[\w$]+)?\s*(?<![=!<>])=(?!=)\s*)(?:"[^"]*"|'[^']*'|[^\s,;'"]+)/gi, `$1${redacted}`)
        .replace(/(\bsessionStorage\b(?:\s*\.\s*[\w$]+|\s*\[\s*(?:"[^"]*"|'[^']*')\s*\]|\s+[\w$]+)?\s*(?<![=!<>])=(?!=)\s*)(?:"[^"]*"|'[^']*'|[^\s,;'"]+)/gi, `$1${redacted}`)
        // Match sensitive JSON keys either exactly or by a credential-bearing
        // suffix (access_token, csrfToken, client_secret, x-api-key, …). The
        // suffix arm is anchored by the closing quote so "author", "session_active",
        // and "idempotency_key" are left untouched.
        .replace(/("(?:authorization|auth|cookie|set-cookie|bearer|session|sessionid|session[_-]?id|sid|localStorage|sessionStorage|[\w-]*(?:token|secret|password|passwd|pwd|apikey|api[_-]?key|credentials?))"\s*:\s*)"[^"]*"/gi, `$1"${redacted}"`)
        .replace(/(<input\b(?=[^>]*\btype\s*=\s*["']password["'])[^>]*\bvalue\s*=\s*)(["'])[^"']*(\2)/gi, `$1$2${redacted}$3`)
        .replace(/(<input\b(?=[^>]*\btype\s*=\s*["']?password\b)[^>]*\bvalue\s*=\s*)([^"'\s>]+)/gi, `$1${redacted}`);

      for (const secret of secrets) {
        output = output.split(secret).join(redacted);
      }

      return output;
    },
    redactObject<T>(value: T): T {
      return redactValue(value, api) as T;
    },
    redactBuffer(body, contentType) {
      if (!isTextContent(contentType)) {
        return body;
      }
      return Buffer.from(api.redactText(body.toString("utf8")), "utf8");
    }
  };

  return api;
}

function redactValue(value: unknown, redactor: Redactor): unknown {
  if (typeof value === "string") {
    return redactor.redactText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, redactor));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactValue(entry, redactor)])
    );
  }
  return value;
}

function redactUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.username !== "") {
      parsed.username = redacted;
    }
    if (parsed.password !== "") {
      parsed.password = redacted;
    }
    for (const key of [...parsed.searchParams.keys()]) {
      if (sensitiveQueryKeys.has(key.toLowerCase())) {
        parsed.searchParams.set(key, redacted);
      }
    }
    redactHashParams(parsed);
    return parsed.href;
  } catch {
    return value;
  }
}

function redactHashParams(parsed: URL): void {
  if (parsed.hash.length <= 1 || !parsed.hash.includes("=")) {
    return;
  }

  const hash = parsed.hash.slice(1);
  const queryIndex = hash.indexOf("?");
  const prefix = queryIndex === -1 ? "" : hash.slice(0, queryIndex + 1);
  const query = queryIndex === -1 ? hash : hash.slice(queryIndex + 1);
  const params = new URLSearchParams(query);
  let changed = false;
  for (const key of [...params.keys()]) {
    if (sensitiveQueryKeys.has(key.toLowerCase())) {
      params.set(key, redacted);
      changed = true;
    }
  }
  if (changed) {
    parsed.hash = `${prefix}${params.toString()}`;
  }
}

function isTextContent(contentType: string | null | undefined): boolean {
  if (!contentType) {
    return false;
  }
  const type = contentType.toLowerCase();
  return type.startsWith("text/") ||
    type.includes("javascript") ||
    type.includes("json") ||
    type.includes("xml") ||
    type.includes("svg") ||
    type.includes("wasm") === false && type.includes("application/x-www-form-urlencoded");
}
