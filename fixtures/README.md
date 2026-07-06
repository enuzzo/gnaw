# Gnaw Fixtures

Local fixture sites for the M0.3 scaffold. These fixtures are deterministic,
self-hosted, and reserved for the harness and future golden snapshots.

Fixture corpus names:

- `static`
- `spa`
- `wordpress`
- `lazy`
- `auth`
- `hostile-paths`

Every fixture origin is a loopback HTTP URL in the form
`http://127.0.0.1:<port>`. The `hostile-paths` fixture also reserves
`http://127.0.0.1:<asset-port>` for future cross-origin asset coverage.

The HTML entrypoints intentionally avoid live external URLs. Future milestones
can expand each site with scripts, styles, protected routes, delayed assets, and
path-normalization cases while preserving the stable corpus names.
