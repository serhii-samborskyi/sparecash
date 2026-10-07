# Integration contracts

All provider values and credentials below are configured in the owner **Settings** screen. Their uppercase names are internal field identifiers, not environment variables. Only `DATABASE_URL` belongs in the app environment. Secrets are masked by default and changes apply to new requests and worker cycles.

## RoundSky

The account's supplied self-optimizing offer is preconfigured:

```text
https://www.rnd3.com/ai/iframeRedirect.php?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.
```

Every application click receives a unique server-generated UUID, passed exclusively in `subId3` as required by RoundSky. `subId` contains the acquisition campaign ID and `subId2` the source zone ID; unattributed visits use `direct`. A follow-up retains the original acquisition attribution and gets a new application ID. The PropellerAds click ID remains stored locally. Pasted placeholder parameters are replaced before redirecting.

Optional prefill is enabled by default and can be turned off in Settings. It uses the visitor's submitted first name (maximum 30 characters), available pending/active email (maximum 100 characters), and US phone (10 digits, with a leading country code removed). Invalid values are omitted; an email is never truncated. The helper also supports last name (30), address (150), and ZIP (5 digits), but the current acquisition form does not collect these. An exact digits-only `rla` quiz answer is passed as the requested amount; range answers are omitted because this field advances RoundSky's form. Skip-subscription redirects contain no contact prefill.

### Native sold-lead pixel

Set the Application URL and RoundSky webhook secret in Settings. Settings → RoundSky connection → Show pixel URL generates the ready-to-paste URL. `npm run roundsky:setup` also exports it to `.local/roundsky-pixel-url.txt` without changing environment variables.

In RoundSky choose seller **LeadTechX**, pixel type **Server 2 Server Requst Pixel**, and paste the generated URL. The template is:

```text
https://sparecash.leadtechx.com/api/webhooks/roundsky/sold?token=<ROUNDSKY_WEBHOOK_TOKEN>&hid=[subId3]&price=[price]&transactionId=[transactionId]
```

Keep the bracketed RoundSky variables literal. The endpoint accepts GET query parameters or POST JSON with the same fields. Authentication uses the separate `ROUNDSKY_WEBHOOK_TOKEN`, supplied as `token` or `X-Webhook-Token`. The secret is generated on first startup and can be replaced in Settings. This endpoint does not accept the general webhook token. Configure proxy logs to redact query strings on webhook and preference URLs.

`hid` resolves the application ID. `price` is the affiliate commission, stored as an exact decimal. `transactionId` supplies the deduplication key `roundsky:sold:<transactionId>`. Valid retries return success without adding revenue or repeating lead events. Reusing a transaction with a different application or price returns HTTP 409. Unresolved macros, missing transaction IDs, invalid amounts, and unknown applications are rejected.

This pixel records **SOLD**, never approval or funding. The default stop event is **Purchased lead**: the sale stops active journeys and cancels pending deliveries across the contact's channels. Attribution and revenue also work for visitors who skipped subscription. Messages already accepted by a provider cannot be recalled.

### Other lifecycle events

Approval, funding, and decline are not present in the supplied pixel contract. The separate normalized ingestion endpoint remains available for a future verified source: `POST /api/webhooks/roundsky` (or GET query fields). It requires the general `WEBHOOK_TOKEN` via `X-Webhook-Token` or `token`; the native pixel secret does not authenticate it.

Normalized payload:

```json
{
  "eventId": "stable-provider-event-id",
  "applicationId": "UUID-sent-in-subId3",
  "event": "SOLD",
  "revenue": 24.5
}
```

Events: `SOLD`, `APPROVED`, `FUNDED`, `DECLINED`. Use stable event IDs so retries are deduplicated. `revenue` is the **incremental affiliate commission for this event**, not the loan principal and not a cumulative amount repeated across lifecycle events. Send zero for lifecycle events that add no commission. A late decline cannot overwrite a funded outcome. Reversals and negative commission adjustments are not currently modeled.

The native integration follows the supplied LeadTechX publisher-link and pixel instructions. Local integration tests exercise redirects and S2S callbacks; an actual account-side pixel fire must still be checked after deployment.

## PropellerAds

Landing link structure:

```text
https://sparecash.leadtechx.com/go/us-loans?campaign_id=CAMPAIGN_MACRO&zone_id=ZONE_MACRO&click_id=CLICK_MACRO
```

Replace placeholders with the current macros shown in your advertiser account. Placeholder names above are illustrative, not assumed provider macro syntax. IDs for campaigns/zones must be numeric. User-supplied URL attribution is not cryptographic proof of a paid click; review exclusion evidence and corroborate against advertiser reporting before enabling live automation.

`PROPELLER_API_TOKEN` authenticates server requests. Exclusions use the documented additive operation:

```text
PATCH https://ssp-api.propellerads.com/v5/adv/campaigns/{campaignId}/targeting/exclude/zone
Authorization: Bearer <token>
Content-Type: application/json

{"zone":["456"]}
```

The app does not replace the full blacklist. Rules require at least the configured sample count and observation age, then compare a 95% Wilson lower bound for suspicious-visit proportion with the threshold. Strong evidence includes a filled hidden field or invalid challenge response. Browser signatures and request velocity contribute weaker evidence. Challenge expiry, user abandonment, and lack of conversion are not alone treated as bot proof. No system can guarantee removal of all bot traffic.

Settings control evaluation; **Live source exclusions** controls whether eligible actions reach the advertiser API. The app records recommendations in observe mode and persists failures. Blocked sources are not automatically re-enabled. Use the advertiser interface to reverse an exclusion; local reconciliation/unblock tools are a future extension.

Spend import, bid management, campaign creation, and advertiser conversion feedback are not part of this initial adapter. Connect PropellerAds' own MCP alongside SpareCash for campaign-level controls.

Official reference: https://ssp-api.propellerads.com/v5/docs/
Official MCP: https://propellerads.com/mcp-connector/

## Cloudflare Turnstile

Set a hostname-restricted site key and secret. The browser uses `action=subscribe` and the server-issued visit ID as `cData`. The server validates the token, hostname, action, and visit binding before recording a subscription. Test keys are allowed only outside production. Tokens are one-use; a failed submission asks for a fresh challenge.

Reference: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

## Lead time zones

In **Settings → Follow-up rules**, choose **Each lead’s time zone** or **Workspace time zone for everyone**. Set the workspace/fallback zone and the start/end hours. In **Audience → open a contact**, select a lead time zone to create an owner override. The contact view shows how its zone was obtained and the effective sending window.

Browser detection works immediately. `BROWSER_FIRST` uses the browser's named IANA zone, then trusted IP location, then the workspace fallback. `IP_FIRST` reverses the first two. IP location is approximate, particularly with VPNs and mobile networks, so browser-first is the default. No browser geolocation permission is requested. New detection priorities apply at subscription capture; stored contacts can be corrected with a manual override.

For IP-based detection on `sparecash.leadtechx.com`:

1. Proxy the domain through Cloudflare. Turnstile alone does not add IP-location headers.
2. Enable the **Add visitor location headers** Managed Transform. Cloudflare supplies `cf-timezone` using the visitor's IP location. See [Cloudflare's header reference](https://developers.cloudflare.com/rules/transform/managed-transforms/reference/#add-visitor-location-headers).
3. Enter a separate random secret of at least 32 characters in **Settings → Cloudflare → IP detection secret** (`CLOUDFLARE_GEO_TOKEN`). Keep it out of public browser code.
4. Add a [Request Header Transform Rule](https://developers.cloudflare.com/rules/transform/request-header-modification/create-dashboard/) for `http.host eq "sparecash.leadtechx.com"`. **Set static** request header `x-sparecash-geo-token` to the same secret, overwriting any incoming value. Do not add it to response headers. Cloudflare's managed `cf-timezone` header is used unchanged.
5. Save connection settings and test a subscription through the proxied domain. With IP-first selected and the edge rule working, the CRM should report **IP location** as the source. The Settings status checks whether the secret is configured; it does not prove that Cloudflare's rules are active.

The app ignores `cf-timezone` if the matching secret is absent or incorrect. Invalid/missing zones fall back to browser or workspace detection; no external lookup request is sent by the app. Existing raw IP storage behavior is unchanged: only hashes are persisted for abuse evidence. IP detection is implemented locally but requires these account-side rules before it works on live traffic.

## Brevo

Set `BREVO_API_KEY`, a verified `BREVO_SENDER_EMAIL`, and `BREVO_FOLDER_ID` for a dedicated SpareCash contact-list folder. Add your real business mailing address in Settings.

Email addresses stay pending until the user explicitly confirms. Confirmation is sent through `/v3/smtp/email`. Marketing follows through `/v3/emailCampaigns`, using a dedicated list for each subscriber so the local per-person sequence engine can select an exact recipient. Contacts are upserted without clearing Brevo blacklist flags. Each email includes your address, the app's preference link, and Brevo's unsubscribe link.

For the initial low-volume deployment, this creates one list per email subscriber and one campaign per email delivery. Plan limits and operational scale must be checked before volume growth. Batch campaigns per step/segment or use a provider-approved personalized marketing transport for larger audiences.

Configure a marketing/suppression webhook to:

```text
https://sparecash.leadtechx.com/api/webhooks/brevo?token=WEBHOOK_TOKEN
```

Accepted normalized fields are `event` and `email`. `unsubscribe`, `unsubscribed`, `spam`, `hard_bounce`, and `blocked` suppress the local subscription immediately. Delivery states currently track provider acceptance rather than guaranteed inbox delivery.

Reference: https://developers.brevo.com/reference/create-email-campaign

## BlueBubbles

Set the HTTPS `BLUEBUBBLES_URL` and `BLUEBUBBLES_PASSWORD`. Sending uses `/api/v1/message/text`, `method: apple-script`, and `chatGuid: SMS;-;+1...`, targeting regular US text numbers. Your Mac/iPhone/forwarding setup must support SMS, including new recipients. That hardware path has not been live-tested here; some versions require creating the chat first, which would require adapting the connector to your server version.

The first requested message contains a short-lived confirmation code. Only confirmed phones receive marketing. OTP attempts are limited. Configure the BlueBubbles `new-message` webhook to:

```text
https://sparecash.leadtechx.com/api/webhooks/bluebubbles?token=WEBHOOK_TOKEN
```

The handler expects `data.isFromMe=false`, `data.text`, and `data.handle.address`. Exact STOP, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE, and OPT OUT messages are recognized case-insensitively. Do not include query-string passwords in logs. BlueBubbles does not provide a dependable provider-wide send-idempotency guarantee; uncertain attempts are held for manual resolution.

Reference: https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks

## OneSignal

Create the web push app for the same HTTPS origin. Set `ONESIGNAL_APP_ID` and the app REST API key. The worker file is `/OneSignalSDKWorker.js`; the public SDK is v16. The browser calls `login` with the server-issued lead ID, asks for permission only after the visitor chooses push, and submits the resulting subscription ID. The backend verifies that the enabled subscription appears on that OneSignal user before activation.

Push uses `include_subscription_ids` and a stable message UUID as `idempotency_key`. The push destination is a signed follow-up page, which includes preference controls. Enable OneSignal identity verification and issue login JWTs before treating external-ID association as high-assurance identity; this initial implementation checks association but does not configure account-side JWT enforcement.

Reference: https://documentation.onesignal.com/docs/en/web-sdk-reference
Reference: https://documentation.onesignal.com/reference/create-message
