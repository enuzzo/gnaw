export const DEFAULT_BLOCK_PATTERNS = [
  "/logout",
  "/signout",
  "/sign-out",
  "/delete",
  "/remove",
  "/checkout",
  "/cart",
  "/billing",
  "/account/delete",
  "/unsubscribe"
] as const;

export function buildBlockPatterns({
  add = [],
  remove = []
}: {
  add?: readonly string[];
  remove?: readonly string[];
} = {}): string[] {
  const removed = new Set(remove.map(normalizePatternKey));
  const defaults = DEFAULT_BLOCK_PATTERNS.filter((pattern) => !removed.has(normalizePatternKey(pattern)));
  return [...defaults, ...add];
}

export function isBlockedNavigationUrl(url: string, patterns: readonly string[] = DEFAULT_BLOCK_PATTERNS): boolean {
  const path = decodePathname(url);
  const segments = path.split("/").filter(Boolean);

  return patterns.some((pattern) => {
    const patternSegments = normalizePattern(pattern);
    if (patternSegments.length === 0) {
      return false;
    }

    if (patternSegments.length === 1) {
      return segments.includes(patternSegments[0]);
    }

    return containsSegmentSequence(segments, patternSegments);
  });
}

function normalizePatternKey(pattern: string): string {
  return `/${normalizePattern(pattern).join("/")}`;
}

function decodePathname(url: string): string {
  const pathname = new URL(url).pathname;
  try {
    return decodeURIComponent(pathname).toLowerCase();
  } catch {
    return pathname.toLowerCase();
  }
}

function normalizePattern(pattern: string): string[] {
  return pattern
    .toLowerCase()
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function containsSegmentSequence(segments: string[], patternSegments: string[]): boolean {
  for (let index = 0; index <= segments.length - patternSegments.length; index += 1) {
    if (patternSegments.every((segment, offset) => segments[index + offset] === segment)) {
      return true;
    }
  }
  return false;
}
