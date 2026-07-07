import type { ScenarioAnalysis, ScenarioEndpoint, ScenarioEndpointKind } from "./analyze.js";

const reportOrder: ScenarioEndpointKind[] = [
  "parse",
  "generate",
  "status",
  "preview",
  "downloadIntent",
  "download",
  "auth",
  "api",
  "page",
  "asset",
  "unknown"
];

export function renderScenarioReport(analysis: ScenarioAnalysis): string {
  const lines = [
    "# Dynamic Site Study",
    "",
    `Network log: \`${analysis.networkLogPath}\``,
    `Response bodies: ${analysis.responseBodyPaths.length > 0 ? analysis.responseBodyPaths.map((path) => `\`${path}\``).join(", ") : "none"}`,
    `Malformed network rows skipped: ${analysis.malformedRows}`,
    "",
    "## Summary",
    "",
    `Auth gate: ${analysis.authGate.required ? "required" : "not observed"}`,
    `Job ids: ${analysis.jobIds.length > 0 ? analysis.jobIds.map((id) => `\`${id}\``).join(", ") : "none observed"}`,
    "",
    "## Endpoint Inventory",
    "",
    "| Kind | Method | Status | Path | Query keys |",
    "| --- | --- | ---: | --- | --- |",
    ...sortedEndpoints(analysis.endpoints).map(endpointRow),
    "",
    "## Auth Gate Evidence",
    "",
    ...authEvidenceLines(analysis),
    "",
    "## Recommended Next Actions",
    "",
    ...nextActions(analysis),
    ""
  ];

  return `${lines.join("\n")}\n`;
}

function sortedEndpoints(endpoints: ScenarioEndpoint[]): ScenarioEndpoint[] {
  return [...endpoints].sort((a, b) => {
    const kindDelta = reportOrder.indexOf(a.kind) - reportOrder.indexOf(b.kind);
    return kindDelta || a.path.localeCompare(b.path) || a.method.localeCompare(b.method);
  });
}

function endpointRow(endpoint: ScenarioEndpoint): string {
  const queryKeys = endpoint.queryKeys.length > 0 ? endpoint.queryKeys.join(", ") : "-";
  return `| ${endpoint.kind} | ${endpoint.method} | ${endpoint.status ?? "-"} | ${endpoint.path} | ${queryKeys} |`;
}

function authEvidenceLines(analysis: ScenarioAnalysis): string[] {
  if (analysis.authGate.evidence.length === 0) {
    return ["- No sign-in, signup, 401, 403, or `auth_required` evidence was observed."];
  }
  return analysis.authGate.evidence.map((item) => `- ${item}`);
}

function nextActions(analysis: ScenarioAnalysis): string[] {
  const actions = [
    "- Keep GPX/test fixtures and generated browser artifacts out of Git; use ignored local paths such as `studies/` and `output/`.",
    "- Do not store plaintext credentials in commands, logs, reports, fixtures, or commits."
  ];

  if (analysis.authGate.required) {
    actions.unshift(
      "- Create or refresh a named auth profile with `gnaw auth login <url> --profile <name>` and close the browser only after the site shows the logged-in state.",
      "- Repeat the scenario with the authenticated profile, then re-run this analysis against the new network log and response bodies.",
      "- Probe direct export endpoints only with the authenticated browser/session when backend responses report `auth_required`."
    );
  } else {
    actions.unshift(
      "- If download/export endpoints are present, try direct GET/POST probes with rate limits and save headers plus content type.",
      "- If no export endpoint appears, rerun the scenario with deeper interaction coverage around preview/download controls."
    );
  }

  return actions;
}
