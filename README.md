<div align="center">

<img src="docs/assets/brand/logo-primary.png" width="136" alt="OpenAPI logo" />

# OpenAPI Platform

<a href="https://github.com/NuoXianTech/openapi-platform"><img src="https://img.shields.io/github/stars/NuoXianTech/openapi-platform?style=flat-square&logo=github" alt="GitHub stars"></a>
<a href="https://github.com/NuoXianTech/openapi-platform/tags"><img src="https://img.shields.io/github/v/tag/NuoXianTech/openapi-platform?style=flat-square&label=version" alt="Version"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-F4D03F?style=flat-square" alt="License"></a>
<a href="https://nuxt.com"><img src="https://img.shields.io/badge/Nuxt-4.x-00DC82?style=flat-square&logo=nuxt&logoColor=white" alt="Nuxt 4"></a>
<a href="https://ui.nuxt.com"><img src="https://img.shields.io/badge/Nuxt_UI-4.x-00DC82?style=flat-square&logo=nuxt&logoColor=white" alt="Nuxt UI 4"></a>
<a href="https://www.postgresql.org"><img src="https://img.shields.io/badge/PostgreSQL-16%2B-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL 16+"></a>

[English](README.md) · [中文](README_ZH.md) · [Documentation](docs/index.md)

OpenAPI Platform is a self-hosted platform for API publishing, access control, usage metering, credit billing, and operations.

</div>

> [!CAUTION]
> This project is under active development. Backward compatibility with existing data is not guaranteed, and local storage formats may change without migration.
>
> If you need a stable branch, fork the project and maintain it independently. Derivative work and pull requests should retain the original author attribution and frontend branding.

## Core features

- **API management model**: Service-discovered endpoints with Products, Versions, governance rules, Targets, and rollback-capable Routing Revisions.
- **Service control plane**: tokens encrypted separately for each Internal Upstream, OpenAPI and generic configuration schema discovery, round-robin and weighted Targets, configuration synchronization, and drift detection.
- **Gateway governance**: API keys, scopes, IP allowlists, expiration, revocation, per-key quotas, per-API daily quotas, and per-second, minute, hour, and day rate limits.
- **Credit billing**: per-HTTP-method pricing, auditable balance transactions, idempotent charging, and retryable failed charges.
- **Observability**: immutable Route call details, login logs, administrator operation logs, and liveness and readiness probes.
- **Identity**: unified user and administrator accounts, email verification, password recovery, session invalidation, GitHub and QQ OAuth binding, and Turnstile abuse protection.
- **Operations**: users, redemption codes, daily rewards, announcements, in-app notifications, friend links, email, OAuth, CAPTCHA, and site settings.
- **Production deployment**: PostgreSQL for standard production, PGlite for lightweight single-process deployments, and Redis for shared rate limits, short-lived caches, and background task coordination.

## Technology

- Nuxt 4, Vue 3, TypeScript, Nitro, VueUse
- Nuxt UI 4, Reka UI, Tailwind CSS 4, TanStack Table, Unovis
- Drizzle ORM, PostgreSQL or PGlite
- ioredis for Redis-based distributed coordination
- Zod, Vitest, ESLint
- Separate API Service: Node.js 24, TypeScript, Hono, Zod/OpenAPI, native Fetch, Vitest

## Runtime configuration

| Variable | Requirement | Description |
| --- | --- | --- |
| `NUXT_AUTH_SECRET` | Required | Signing secret for JWTs, email verification, one-time tokens, and OAuth state. |
| `NUXT_API_KEY_SECRET` | Required | Generates API keys and provides domain-separated protection for API keys, redemption codes, Upstream tokens, and Service business secrets. |
| `DATABASE_URL` | Optional | PostgreSQL connection URL. |
| `NITRO_HOST`, `NITRO_PORT` | Optional | Node server listen address and port. |

When `DATABASE_URL` is set, the Platform uses PostgreSQL; otherwise it automatically uses PGlite. PGlite always stores data in the fixed `.data/pglite` directory, which must be persistent and backed up in production. Redis is optional when `NUXT_REDIS_URL` is empty; once configured, Redis is required for coordinated operations. See [runtime configuration](docs/operations/runtime-config.md) for the complete behavior and security boundaries.

## Quick start

### Local development

```bash
git clone https://github.com/NuoXianTech/openapi-platform.git
cd openapi-platform
pnpm install
cp .env.example .env
pnpm dev
```

### Docker

```bash
git clone https://github.com/NuoXianTech/openapi-platform.git
cd openapi-platform
cp .env.example .env
docker network inspect openapi-network > /dev/null 2>&1 || docker network create openapi-network
docker compose up -d
```

Before starting, configure `NUXT_AUTH_SECRET` and `NUXT_API_KEY_SECRET`. API key owners and administrators managing redemption codes can reveal complete values on demand; ordinary lists and history show masked previews only. Every reveal is recorded without the secret value. The database stores no plaintext secret columns. Generate independent random values with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

After startup, visit `http://localhost:3000`. Docker Compose listens on local port 3000 only by default.

## Project structure

```text
app/                         Nuxt pages, components, composables, and UI assets
server/api/                  Internal user and administrator endpoints
server/services/             Routing, Service control, billing, and cross-domain rules
server/db/                   Drizzle client, schema, and migrations
server/middleware/           Security headers and the dynamic Gateway entry
server/plugins/              Startup initialization, statistics, and retry workers
shared/                      Client-safe schemas, contracts, and configuration
docs/                        Project-specific standards and production workflows
```

## Documentation

- [Documentation index](docs/index.md)
- [Architecture documentation](docs/architecture/README.md)
- [Platform architecture](docs/architecture/platform.md)
- [Service architecture](docs/architecture/service.md)
- [Runtime protocols](docs/architecture/runtime-protocols.md)
- [Version and support scope](docs/architecture/release-scope.md)
- [Platform and Service integration testing](docs/operations/service-integration-testing.md)
- [Public API development guide](docs/api/public-api-development.md)
- [Public API conventions](docs/api/public-api-conventions.md)
- [Frontend engineering standards](docs/standards.md)
- [API billing rules](docs/architecture/billing.md)
- [Runtime configuration](docs/operations/runtime-config.md)
- [VPS deployment guide](docs/operations/vps-deployment.md)

## Contributing

Issues and pull requests are welcome.

## License

This project is licensed under the [MIT License](LICENSE). Anyone may use, copy, modify, distribute, sublicense, and sell the project, including as part of proprietary software.
