export const FIXTURE_NAMES = [
  "static",
  "spa",
  "wordpress",
  "lazy",
  "auth",
  "hostile-paths"
] as const;

export type FixtureName = (typeof FIXTURE_NAMES)[number];

export type FixtureDefinition = {
  name: FixtureName;
  title: string;
  purpose: string;
  publicDir: `fixtures/sites/${FixtureName}/public`;
  origin: `http://127.0.0.1:${number}`;
  extraOrigins?: readonly [`http://127.0.0.1:${number}`];
};

export const fixtureRegistry: Record<FixtureName, FixtureDefinition> = {
  static: {
    name: "static",
    title: "Static Fixture",
    purpose: "Plain HTML baseline for deterministic captures.",
    publicDir: "fixtures/sites/static/public",
    origin: "http://127.0.0.1:43110"
  },
  spa: {
    name: "spa",
    title: "SPA Fixture",
    purpose: "Client-rendered app shape with future fetch and chunk coverage.",
    publicDir: "fixtures/sites/spa/public",
    origin: "http://127.0.0.1:43111"
  },
  wordpress: {
    name: "wordpress",
    title: "WordPress Fixture",
    purpose: "WordPress-like markup with future wp-content asset paths.",
    publicDir: "fixtures/sites/wordpress/public",
    origin: "http://127.0.0.1:43112"
  },
  lazy: {
    name: "lazy",
    title: "Lazy Fixture",
    purpose: "Delayed and scroll-triggered asset coverage for future captures.",
    publicDir: "fixtures/sites/lazy/public",
    origin: "http://127.0.0.1:43113"
  },
  auth: {
    name: "auth",
    title: "Auth Fixture",
    purpose: "Login-gated flow shape for future profile and redaction tests.",
    publicDir: "fixtures/sites/auth/public",
    origin: "http://127.0.0.1:43114"
  },
  "hostile-paths": {
    name: "hostile-paths",
    title: "Hostile Paths Fixture",
    purpose: "Path-normalization edge cases and future cross-origin assets.",
    publicDir: "fixtures/sites/hostile-paths/public",
    origin: "http://127.0.0.1:43115",
    extraOrigins: ["http://127.0.0.1:43116"]
  }
};
