export const DEFAULT_GUARDRAILS = {
  maxPages: 200,
  maxTotalBytes: 2147483648,
  maxAssetBytes: 104857600
} as const;

export type GuardrailLimitName = "max_pages" | "max_total_bytes";

export type GuardrailDecision =
  | { hit: false }
  | {
      hit: true;
      result: "partial";
      reason: GuardrailLimitName;
      limit: number;
      observed: number;
    };

export type AssetTooLargeWarning = {
  type: "warning";
  code: "asset_too_large";
  url: string;
  sizeBytes: number;
  limit: number;
  action: "skipped";
};

export function evaluateMaxPages({
  pagesCaptured,
  maxPages = DEFAULT_GUARDRAILS.maxPages
}: {
  pagesCaptured: number;
  maxPages?: number;
}): GuardrailDecision {
  if (pagesCaptured < maxPages) {
    return { hit: false };
  }

  return {
    hit: true,
    result: "partial",
    reason: "max_pages",
    limit: maxPages,
    observed: pagesCaptured
  };
}

export function evaluateMaxTotalBytes({
  totalBytes,
  nextBytes = 0,
  maxTotalBytes = DEFAULT_GUARDRAILS.maxTotalBytes
}: {
  totalBytes: number;
  nextBytes?: number;
  maxTotalBytes?: number;
}): GuardrailDecision {
  const observed = totalBytes + nextBytes;
  if (observed <= maxTotalBytes) {
    return { hit: false };
  }

  return {
    hit: true,
    result: "partial",
    reason: "max_total_bytes",
    limit: maxTotalBytes,
    observed
  };
}

export function assetTooLargeWarning({
  url,
  sizeBytes,
  maxAssetBytes = DEFAULT_GUARDRAILS.maxAssetBytes
}: {
  url: string;
  sizeBytes: number;
  maxAssetBytes?: number;
}): AssetTooLargeWarning | null {
  if (sizeBytes <= maxAssetBytes) {
    return null;
  }

  return {
    type: "warning",
    code: "asset_too_large",
    url,
    sizeBytes,
    limit: maxAssetBytes,
    action: "skipped"
  };
}
