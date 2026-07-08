import { readFile } from "node:fs/promises";

export type ScenarioEndpointKind =
  | "page"
  | "asset"
  | "api"
  | "parse"
  | "generate"
  | "status"
  | "preview"
  | "downloadIntent"
  | "download"
  | "auth"
  | "unknown";

export type ScenarioEndpoint = {
  kind: ScenarioEndpointKind;
  method: string;
  url: string;
  path: string;
  status: number | null;
  contentType: string;
  queryKeys: string[];
};

export type ScenarioAnalysis = {
  networkLogPath: string;
  responseBodyPaths: string[];
  endpoints: ScenarioEndpoint[];
  countsByKind: Record<ScenarioEndpointKind, number>;
  jobIds: string[];
  authGate: {
    required: boolean;
    evidence: string[];
  };
  malformedRows: number;
};

export type AnalyzeScenarioOptions = {
  networkLogPath: string;
  responseBodyPaths?: string[];
};

type NetworkRow = {
  type?: unknown;
  method?: unknown;
  url?: unknown;
  status?: unknown;
  contentType?: unknown;
};

const endpointKinds: ScenarioEndpointKind[] = [
  "page",
  "asset",
  "api",
  "parse",
  "generate",
  "status",
  "preview",
  "downloadIntent",
  "download",
  "auth",
  "unknown"
];

export async function analyzeScenario({
  networkLogPath,
  responseBodyPaths = []
}: AnalyzeScenarioOptions): Promise<ScenarioAnalysis> {
  const { rows, malformedRows } = await readNetworkRows(networkLogPath);
  const endpoints = rows.map(toEndpoint).filter((endpoint): endpoint is ScenarioEndpoint => endpoint !== null);
  const bodyEvidence = await scanResponseBodies(responseBodyPaths);
  const statusEvidence = endpoints
    .filter((endpoint) => endpoint.status === 401 || endpoint.status === 403)
    .map((endpoint) => `${endpoint.status} ${endpoint.method} ${endpoint.path}`);
  const evidence = [...bodyEvidence, ...statusEvidence];

  return {
    networkLogPath,
    responseBodyPaths,
    endpoints,
    countsByKind: countKinds(endpoints),
    jobIds: collectJobIds(endpoints),
    authGate: {
      required: evidence.length > 0,
      evidence
    },
    malformedRows
  };
}

async function readNetworkRows(path: string): Promise<{ rows: NetworkRow[]; malformedRows: number }> {
  const raw = await readFile(path, "utf8");
  const rows: NetworkRow[] = [];
  let malformedRows = 0;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      rows.push(JSON.parse(line) as NetworkRow);
    } catch {
      malformedRows += 1;
    }
  }

  return { rows, malformedRows };
}

function toEndpoint(row: NetworkRow): ScenarioEndpoint | null {
  if (row.type !== "response" || typeof row.url !== "string") {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(row.url);
  } catch {
    return null;
  }

  const method = typeof row.method === "string" ? row.method.toUpperCase() : "GET";
  const status = typeof row.status === "number" ? row.status : null;
  const contentType = typeof row.contentType === "string" ? row.contentType : "";
  const path = parsed.pathname;

  return {
    kind: classifyEndpoint(method, path, contentType),
    method,
    url: parsed.href,
    path,
    status,
    contentType,
    queryKeys: [...parsed.searchParams.keys()].sort()
  };
}

function classifyEndpoint(method: string, path: string, contentType: string): ScenarioEndpointKind {
  const lowerPath = path.toLowerCase();
  const lowerType = contentType.toLowerCase();

  if (/(^|\/)(login|logout|signup|auth|session|callback)(\/|$)/.test(lowerPath)) return "auth";
  if (/(^|\/)parse(\/|$)/.test(lowerPath)) return "parse";
  if (method === "POST" && /(^|\/)(upload|generate|render|model|mesh)(\/|$)/.test(lowerPath)) return "generate";
  if (/(^|\/)status(\/|$)/.test(lowerPath)) return "status";
  if (/(^|\/)(preview|preview_mesh|preview_points)(\/|$)/.test(lowerPath) || lowerType.includes("model/gltf")) return "preview";
  if (/(^|\/)(download-intent|register_download)(\/|$)/.test(lowerPath)) return "downloadIntent";
  if (/(^|\/)(download|export)(\/|$)/.test(lowerPath)) return "download";
  if (lowerType.includes("text/html")) return "page";
  if (/\.(js|css|png|jpg|jpeg|svg|webp|gif|woff2?|ttf|otf)$/i.test(path)) return "asset";
  if (lowerType.includes("json") || lowerPath.includes("/api/")) return "api";
  return "unknown";
}

async function scanResponseBodies(paths: string[]): Promise<string[]> {
  const evidence: string[] = [];
  for (const path of paths) {
    const body = await readFile(path, "utf8").catch(() => "");
    const normalized = body.toLowerCase();
    if (normalized.includes("auth_required")) evidence.push(`${path}: auth_required`);
    if (/\bsign\s*in\b|\blog\s*in\b|\bsignup\b/.test(normalized)) evidence.push(`${path}: sign-in prompt`);
    if (normalized.includes('"status":401') || normalized.includes('"status": 401')) evidence.push(`${path}: 401 body`);
  }
  return evidence;
}

function countKinds(endpoints: ScenarioEndpoint[]): Record<ScenarioEndpointKind, number> {
  const counts = Object.fromEntries(endpointKinds.map((kind) => [kind, 0])) as Record<ScenarioEndpointKind, number>;
  for (const endpoint of endpoints) {
    counts[endpoint.kind] += 1;
  }
  return counts;
}

function collectJobIds(endpoints: ScenarioEndpoint[]): string[] {
  const ids = new Set<string>();
  for (const endpoint of endpoints) {
    const parts = endpoint.path.split("/").filter(Boolean);
    for (let index = 0; index < parts.length - 1; index += 1) {
      const marker = parts[index].toLowerCase();
      if (["status", "download-intent", "register_download", "download", "download_token", "preview_mesh", "preview_points"].includes(marker)) {
        ids.add(parts[index + 1]);
      }
    }
  }
  return [...ids].sort();
}
