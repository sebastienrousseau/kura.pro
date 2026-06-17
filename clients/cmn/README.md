# cmn — shared asset library

**Not a tenant zone.** Short-name shared assets reused across multiple tenants (the directory name is intentionally compact to keep CDN URLs short).

Routing: `https://cloudcdn.pro/cmn/v1/...` resolves to `clients/cmn/v1/...` like any tenant, but the assets here are referenced by other zones rather than belonging to one tenant.
