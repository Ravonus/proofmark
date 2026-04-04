# Proofmark

Web3-native document signing. Cryptographic wallet signatures, multi-chain support, and a full field system — no centralized authority needed.

## Features

- **Wallet-based signing** — Sign with Ethereum, Base, Solana, or Bitcoin wallets
- **Rich field system** — 30+ field types: text, date, signature, payment, address autocomplete, ID verification, and more
- **PDF analysis** — Upload existing PDFs and auto-detect signature fields, blanks, and form structure
- **Sequential & parallel signing** — Enforce signing order or let all parties sign simultaneously
- **Audit trail** — Immutable, hash-chained event log for every document action
- **Zero-knowledge vault** — Client-side encryption with optional key escrow
- **Email + OTP signing** — Signers without wallets can sign via email one-time-password
- **Webhooks & embedded signing** — Integrate into your own app with webhook events or iframe embedding
- **Templates** — Save and reuse document structures
- **Branding** — Custom logos, colors, and email templates
- **Post-sign reveal** — Gate access to resources behind completed signatures
- **BYO integrations** — Plug in your own Twilio (SMS), Stripe (payments), Mapbox (address autocomplete), or OAuth keys

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 15+

### Setup

```bash
# Clone and install
git clone https://github.com/user/proofmark.git
cd proofmark
npm install --legacy-peer-deps

# Configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL and optional SMTP settings

# Push database schema
npm run db:push

# Start dev server (OSS mode)
npm run dev
```

The app runs at `http://localhost:3100`.

### Docker

```bash
docker compose up -d
```

See `docker-compose.yml` and `Dockerfile` for configuration.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `SMTP_HOST` | No | `""` | SMTP server for email delivery |
| `SMTP_PORT` | No | `465` | SMTP port |
| `SMTP_USER` | No | `""` | SMTP username |
| `SMTP_PASS` | No | `""` | SMTP password |
| `SMTP_FROM` | No | `noreply@proofmark.local` | Sender email address |
| `ADMIN_EMAIL` | No | `""` | Admin notification email |
| `OWNER_ADDRESS` | No | `""` | Default wallet address for the instance owner |
| `OWNER_CHAIN` | No | `ETH` | Default chain for the instance owner |
| `ENCRYPTION_MASTER_KEY` | No | — | 32+ char key for at-rest encryption (enables vault features) |
| `AUTOMATION_SECRET` | No | `""` | Secret for cron-triggered automation endpoints |
| `NEXTAUTH_URL` | No | `http://localhost:3100` | Base URL for auth callbacks |

### BYO Integration Keys (optional)

| Variable | Description |
|---|---|
| `AUTH_GOOGLE_CLIENT_ID` / `AUTH_GOOGLE_CLIENT_SECRET` | Google OAuth SSO |
| `AUTH_GITHUB_CLIENT_ID` / `AUTH_GITHUB_CLIENT_SECRET` | GitHub OAuth SSO |
| `AUTH_MICROSOFT_CLIENT_ID` / `AUTH_MICROSOFT_CLIENT_SECRET` | Microsoft OAuth SSO |
| `AUTH_OKTA_CLIENT_ID` / `AUTH_OKTA_CLIENT_SECRET` / `AUTH_OKTA_ISSUER` | Okta SSO |

## Architecture

```
src/
  app/          Next.js 15 App Router (pages + API routes)
  components/   React components (editor, signing flow, dashboard)
  server/       Backend logic (tRPC routers, PDF processing, email, auth)
  lib/          Shared utilities (hashing, verification, field runtime)
```

**Stack:** Next.js 15 + React 19 + tRPC 11 + Drizzle ORM + PostgreSQL + Tailwind CSS

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server (OSS mode) |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run type-check` | Run TypeScript compiler |
| `npm run format` | Format code with Prettier |
| `npm run validate` | Run all checks (type-check + lint + format + test) |
| `npm run test` | Run tests |
| `npm run db:push` | Push schema to database |
| `npm run db:studio` | Open Drizzle Studio |

## Premium

The `premium/` directory contains optional premium features (blockchain anchoring, teams, RBAC, managed wallets). It is not included in the OSS distribution. The OSS build degrades gracefully — all premium features are gated behind runtime checks and never hard-imported.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and PR guidelines.

## License

[AGPL-3.0](LICENSE)
