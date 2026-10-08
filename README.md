# SpareCash

A self-hosted US loan-affiliate acquisition workspace: mobile landing pages and quizzes, an owner-only CRM, configurable A/B tests, consent-based follow-ups, traffic-source protection, and a remote MCP server.

Built with Node.js 22, TypeScript, Express, React, Prisma 6, and PostgreSQL. The web process and worker share PostgreSQL; Redis is not required. Designed for Coolify.

## Run locally

```bash
npm ci
npm run local:setup
npm run dev
```

`local:setup` uses locally installed PostgreSQL binaries (`PG_BIN`, default `/usr/lib/postgresql/18/bin`), starts an isolated loopback server on port 55432, applies migrations, and creates draft starter content. It writes `DATABASE_URL` and `OWNER_PASSWORD` to the ignored `.env` file. Read `OWNER_PASSWORD` there to sign in. Application settings and provider credentials live directly in PostgreSQL; no encryption key file or application storage volume is required. Existing settings are preserved when readable.

Open **http://localhost:3000/admin**. The starter experiment includes a direct prelander and a two-question quiz; three draft chains cover email, SMS, and push. Preview variants from Experiments. There are no fabricated contacts or conversion statistics.

Run the independent worker with `npm run worker`. Development sends and source exclusions are disabled initially. Local Turnstile keys are Cloudflare's documented test keys; production rejects them.

## Coolify deployment

1. Create a PostgreSQL service in Coolify. Deploy this repository using its Dockerfile, or use `docker-compose.yml` to run both web and worker.
2. In **Environment Variables**, set **`DATABASE_URL`** and **`OWNER_PASSWORD`** (your chosen login password). Set both as runtime variables, with the same values on web and worker. No password hashing command is needed. The image sets runtime mode and port.
3. Configure **https://sparecash.leadtechx.com** on the web application, port **3000**. Keep PostgreSQL and the worker private. With Dockerfile deployments, run a second service from the same image with command `node dist/server/worker.js`.
4. Deploy and sign in at `/admin` with your `OWNER_PASSWORD`. To change it, update the environment variable and redeploy web and worker; existing owner sessions are signed out. No `/app/data` volume is needed for normal operation.
5. In **Settings**, set the Application URL, provider keys, RoundSky webhook secret, MCP token, business details, and disclosures. Domain and RoundSky offer defaults are preconfigured. All live switches start disabled. Credentials remain masked unless explicitly revealed.
6. Under **Provider connections → RoundSky**, click **Copy pixel URL**. In RoundSky select **LeadTechX → Server 2 Server Requst Pixel** and paste the URL with bracketed variables intact.
7. Use **Test connection** under OneSignal, Brevo, BlueBubbles, and PropellerAds. Copy the BlueBubbles reply URL into its `new-message` webhook. Test actual delivery and a RoundSky callback separately, then enable live delivery and source exclusions when ready.

Saved connection settings apply to subsequent requests and worker cycles without a restart. PostgreSQL backups include provider credentials; protect access to those backups. Keep `OWNER_PASSWORD` in your hosting configuration. Moving to another container or restoring the database requires no key file.

**Upgrading from encrypted settings:** add `OWNER_PASSWORD` before redeploying. If the old `/app/data/master.key` is accessible, credentials migrate automatically without changing provider tokens or links. Keep an existing key mount for this first deployment if it contains the original key. If the key is missing, unreadable, or does not match, the app starts with your environment password and preserves CRM records, campaigns, and public settings. Provider credentials reset, access/tracking tokens regenerate, and live delivery/source exclusions are disabled. Settings shows a notice to reconnect providers, update webhook URLs and MCP credentials, and replace old confirmation/preference/tracking links. The old encrypted bundle is retained in the database as a backup, but is no longer used. Once upgraded, remove the app storage mount if desired.

For an older installation with provider credentials in `.env`, set `OWNER_PASSWORD` and run `npm run config:migrate`. It imports connection values on first initialization, keeps a private `.local/legacy-env.backup`, and leaves `DATABASE_URL` and `OWNER_PASSWORD` in `.env`. An optional `-- --app-url=https://sparecash.leadtechx.com` sets the public origin. Subsequent starts use saved provider settings; the owner password always comes from the environment.

`npm run roundsky:setup` exports the pixel URL from the saved configuration to `.local/roundsky-pixel-url.txt`; it does not create environment variables. The same URL is available in the owner Settings screen.

The worker runs separately and acquires a database advisory lock. In-memory HTTP rate limiting assumes one web replica; use a shared store before scaling. Docker Compose now connects to an existing PostgreSQL service; it does not provision or replace the database itself.

## What is implemented

- Published, weighted landing/quiz variants with sticky assignments; public pages at `/go/:slug`, owner previews at `/preview/:experimentId`.
- Configurable goals: confirmed subscriptions, purchased leads, approvals, funded loans, or recorded revenue per visitor. Reports do not claim statistical significance or automatically reallocate traffic.
- Visitor attribution using `campaign_id`, `zone_id`, and `click_id`; campaign/source passed to RoundSky's `subId`/`subId2` and a distinct server-generated application ID in `subId3`.
- Turnstile server verification bound to the visit and action; honeypot and request-pattern evidence; per-source sample thresholds, observation periods, and Wilson confidence bounds.
- PropellerAds v5 source exclusion adapter, with additive PATCH operations and an audit trail. No silent exclusions when live mode is disabled.
- Channel-specific consent records and immutable copies of the landing configuration seen by each visitor. Email confirmation, phone OTP verification, and OneSignal subscription verification precede activation.
- One active journey per subscription; per-channel rolling 24-hour cap, recipient-local sending hours, maximum journey lifetime, and subscribed/clicked/declined/no-conversion triggers.
- Time-zone selection in Settings and per-contact CRM/MCP overrides. Prefer browser detection or trusted Cloudflare IP location, with a workspace fallback; optionally schedule everyone in one zone. Sending windows respect daylight saving. [IP detection setup](docs/INTEGRATIONS.md#lead-time-zones).
- Brevo marketing campaign sending, BlueBubbles SMS adapter, and OneSignal push sending. Transactional Brevo email is used only for subscription confirmation.
- RoundSky's native sold-lead S2S pixel with separate authentication, decimal commission storage, transaction deduplication, and cancellation of pending messages across channels. Optional prefill uses the visitor's available name/contact details and an exact requested amount when collected.
- Brevo suppression webhooks, BlueBubbles inbound STOP handling, channel preference pages, and manual owner unsubscribe controls.
- Durable send intent, worker locking, explicit uncertain-delivery states, and a UI for checking provider logs and resolving attempts before retry.
- Remote MCP over Streamable HTTP at `/mcp`, with bearer authentication and audited writes. External AI clients generate content and call the experiment/chain tools; no embedded AI-chat subscription is required.

## Validation

```bash
npm test
npm run build
node scripts/check-bootstrap.mjs
npm audit
```

Tests apply migrations in the isolated `sparecash_test` schema and truncate only that schema. `TEST_DATABASE_URL` can point at another PostgreSQL database. Integration tests use a real database and mocked provider responses; **no emails, texts, push notifications, or advertiser changes are sent by the test suite**.

After building, `check-bootstrap.mjs` verifies a fresh production startup with the database URL and environment password, credential persistence after deleting all container data, password rotation, and upgrades with and without the legacy key. It uses a temporary schema and private data directory and removes both afterward.

See [integration contracts](docs/INTEGRATIONS.md), [MCP usage](docs/MCP.md), and [architecture and operating limits](docs/ARCHITECTURE.md).

## Remaining account-specific setup

The production domain and RoundSky's supplied hosted-link/sold-lead pixel contract are configured. Deployment, provider credentials, and a real account-side callback test remain before live traffic. The supplied pixel does not report approval, funding, or rejection; those outcomes need separately verified events. An embedded form or direct-application API would require an additional adapter.

Credit-repair offers are intentionally absent. Branches can be configured later, but a missing conversion is never represented as an explicit rejection. Backend credentials are stored directly in PostgreSQL and managed in owner Settings; the dashboard reports configuration presence, not a successful live connectivity test. The MCP endpoint supports clients with configurable bearer headers; OAuth-only clients require an OAuth gateway.
