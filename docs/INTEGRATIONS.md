# Integration contracts

All provider values and credentials below are configured in the owner **Settings** screen. Their uppercase names are internal field identifiers, not environment variables. Set `DATABASE_URL` and `OWNER_PASSWORD` in the app environment. Secrets are masked by default and changes apply to new requests and worker cycles.

## Connection tests

Settings auto-save when you leave a field; switches and selects save immediately. Wait for **All changes saved**, then use **Test connection** under Microsoft Clarity, OneSignal, Brevo, MyEmailVerifier, BlueBubbles, or PropellerAds. Tests work with live delivery and source exclusions disabled. Each result distinguishes credential access from incomplete setup; edits invalidate results and require saving before another test. Provider response bodies, credentials, and account data are not returned or included in the audit entry.

- **Microsoft Clarity:** reads one day of aggregate dashboard data to verify the Data Export token. The check consumes one of the project's ten daily export requests and does not import or return the rows. [Data Export reference](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api).
- **OneSignal:** reads one message listing using the app API key. This checks app access, not browser subscription or push delivery. [API reference](https://documentation.onesignal.com/reference/view-messages).
- **Brevo:** checks account access, the saved sender's active status, and the app's business mailing address. No email is created. [Senders](https://developers.brevo.com/reference/get-senders).
- **MyEmailVerifier:** performs one verification request for the provider's support mailbox. Any successfully parsed mailbox status proves API access; visitor submissions still require `Valid`. This consumes one single-address validation request and does not save a contact.
- **BlueBubbles:** reads server information and registered webhooks, checking that the current reply URL is registered for `new-message`. It does not verify SMS forwarding or actual incoming delivery; test those with your own phone. [Server API](https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks).
- **PropellerAds:** reads the advertiser balance endpoint to verify API access, discarding the balance. This does not test exclusion write permissions or change campaigns. [API reference](https://ssp-api.propellerads.com/v5/docs/).

Tests use authenticated owner-only `POST /api/admin/integrations/{provider}/test` endpoints (`clarity`, `onesignal`, `brevo`, `myemailverifier`, `bluebubbles`, `propellerads`). Only saved settings are used. Requests time out after 12 seconds each and do not follow redirects.

## Microsoft Clarity

Save the public project ID and the project's Data Export token in **Settings → Provider connections → Microsoft Clarity**. The token is stored with the other provider credentials, remains server-side, and is never returned through public routes, the admin configuration response, or MCP. Published landing visits load Clarity; owner previews, admin pages, legal pages, confirmation pages, and preferences pages do not.

Before Clarity loads, the landing removes click IDs and other high-cardinality provider parameters from the visible URL. It retains only campaign, zone, and UTM attribution. The client sends non-personal session tags for experiment, variant, campaign, zone, creative, and verification state, plus events for quiz/update engagement, application continuation, subscription submission, and channel confirmation. It never sends names, email addresses, phone numbers, lead IDs, visit IDs, application IDs, or provider click IDs as custom tags. Contact controls are explicitly covered by `data-clarity-mask`; Clarity also masks input content in every masking mode. A saved advertising opt-out or Global Privacy Control prevents the Clarity script from loading.

The worker imports one aggregate one-day dashboard snapshot when at least 20 hours have passed since its last attempt. Snapshots use the `URL`, `Campaign`, and `Device` dimensions, are retained for 90 days, and contain no recordings or submitted form values. Clarity limits exports to the last one to three days, 1,000 rows, three dimensions, and ten requests per project per day. The test button and manual `sync_clarity` calls also consume requests.

Use `clarity_status` to inspect configuration and sync health, `sync_clarity` for an intentional manual import, and `clarity_report` for campaign/zone session, device, and estimated bot-session aggregates. Clarity estimates are supporting evidence only. Compare them with SpareCash verification, engagement and outcomes plus authenticated PropellerAds cost and source data. Clarity never changes source state, advertiser targeting, or the automatic exclusion rules.

The site's Privacy Policy must disclose Microsoft Clarity analytics and link to Microsoft's privacy information. Review the Clarity project's masking and retention settings before launch. References: [Clarity client API and masking](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-api), [Clarity Data Export API](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api), and [Microsoft Privacy Statement](https://privacy.microsoft.com/privacystatement).

## Confirm actual delivery

Each messaging provider has a **Send test** control in Settings. These owner-only sends work with **Live message delivery** disabled, target one entered recipient, and do not enroll contacts or start chains. Only clicking the send button sends a message; auto-saving credentials never sends a test.

- **BlueBubbles:** select SMS or iMessage, enter your own phone number including country code, and click **Send test SMS/iMessage**. iMessage mode also accepts an Apple ID email for a test. Check receipt on the destination device. Existing phone contacts' replies can also verify the reply webhook.
- **OneSignal:** subscribe on your phone through a published landing page. In OneSignal's Audience → Subscriptions, copy that device's Subscription ID into **Test push subscription ID**, then click **Send test push**. The app ID is not a device subscription ID. [Targeting by subscription](https://documentation.onesignal.com/reference/create-message).
- **Brevo:** enter your own email address. Test both **Confirmation email (transactional)** and **Follow-up email (transactional)**. Both send exactly one message through `/v3/smtp/email`; the follow-up test also renders the branded HTML format and requires the business address. Check your inbox and spam folder. [Brevo transactional email API](https://developers.brevo.com/reference/sendtransacemail).

“Accepted by provider” means the API accepted the request, not that a device or inbox received it. Results show a provider reference when available. If a request times out or returns an ambiguous result, inspect the device/provider logs before starting another test. The app does not automatically retry these sends, and repeated requests with the same test ID are blocked. Rate limits allow five test requests per minute per client IP.

For the complete follow-up flow, enable live delivery after these checks, use a real subscription on your own device, activate the channel's chain, and keep the worker running. Follow-up chains still respect consent, recipient time zone, daily caps, and configured delays. The test button checks delivery directly; it does not exercise the scheduling worker.

## RoundSky

The account's supplied self-optimizing offer is preconfigured:

```text
https://www.rnd3.com/ai/iframeRedirect.php?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.
```

Every application click receives a unique server-generated UUID, passed exclusively in `subId3` as required by RoundSky. `subId` contains the acquisition campaign ID and `subId2` the source zone ID; unattributed visits use `direct`. A follow-up retains the original acquisition attribution and gets a new application ID. The PropellerAds click ID remains stored locally. Pasted placeholder parameters are replaced before redirecting.

Optional prefill is enabled by default and can be turned off in Settings. It uses the visitor's submitted first name (maximum 30 characters), available pending/active email (maximum 100 characters), and US phone (10 digits, with a leading country code removed). Invalid values are omitted; an email is never truncated. The helper also supports last name (30), address (150), and ZIP (5 digits), but the current acquisition form does not collect these. An exact digits-only `rla` quiz answer is passed as the requested amount; range answers are omitted because this field advances RoundSky's form. Skip-subscription redirects contain no contact prefill.

### Native sold-lead pixel

Set the Application URL and RoundSky webhook secret in Settings, then leave the field and wait for **All changes saved**. **Settings → Provider connections → RoundSky** displays the ready-to-paste URL directly below the secret, with a **Copy pixel URL** button. Unsaved URL or secret changes disable copying until saved. `npm run roundsky:setup` also exports it to `.local/roundsky-pixel-url.txt` without changing environment variables.

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
https://sparecash.leadtechx.com/go/us-loans?campaign_id={campaign_id}&zone_id={zone_id}&click_id=${SUBID}&banner_id={bannerid}&browser={browser}&browser_version={browser_version}&carrier={carrier}&connection_type={connection_type}&cost={cost}&country={country}&device={device}&language={language}&os={os}&os_version={osversion}&region={region}&subzone_id={subzone_id}&advertiser_user_agent={useragent}&utm_source=propellerads&utm_medium=push&utm_campaign=us-loans&utm_content={bannerid}
```

This template carries every usable token offered for the current push CPC campaigns. The app stores the values in each visit's `adContext`; `list_traffic_visits` exposes them and Statistics can break visits down by creative, subzone, connection, carrier, language, browser version, and OS version. `${SUBID}` is the conversion-attribution ID. Do not add the unsupported `{clickID}` alias; PropellerAds leaves it unresolved.

URL attribution is not cryptographic proof of a paid click. The app never treats `{cost}` as booked spend and never lets token-supplied country, region, or user agent replace trusted edge/security observations. Reconcile costs and campaign totals against authenticated advertiser reporting.

`PROPELLER_API_TOKEN` authenticates server requests. Exclusions use the documented additive operation:

```text
PATCH https://ssp-api.propellerads.com/v5/adv/campaigns/{campaignId}/targeting/exclude/zone
Authorization: Bearer <token>
Content-Type: application/json

{"zone":["456"]}
```

The app does not replace the full blacklist. Rules require at least the configured sample count and observation age, then compare a 95% Wilson lower bound for suspicious-visit proportion with the threshold. Strong evidence includes a filled hidden field or invalid challenge response. Browser signatures and request velocity contribute weaker evidence. Challenge expiry, user abandonment, and lack of conversion are not alone treated as bot proof. No system can guarantee removal of all bot traffic.

Settings control evaluation; **Live source exclusions** controls whether eligible actions reach the advertiser API. The app records recommendations in observe mode and persists failures. Blocked sources are not automatically re-enabled. Use the advertiser interface to reverse an exclusion; local reconciliation/unblock tools are a future extension.

The owner Statistics view imports authenticated spend. Campaign and bid changes remain in PropellerAds or its MCP.

Copy the account S2S URL from **PropellerAds → Tracking** into **Settings → Integrations → PropellerAds S2S postback URL**. SpareCash preserves its account parameters and supplies `visitor_id`, `payout`, and the goal:

- a deduplicated RoundSky SOLD callback sends the main conversion (goal 1)
  with commission as payout;
- a server-recorded application continuation sends `goal=2`;
- a captured email/text opt-in or confirmed push opt-in sends `goal=3`; optional email/text address verification is not required.

Only attributed visits with a valid provider click ID qualify. The database
enforces one row per click ID and goal, so refreshes and repeat application
clicks cannot send the same event twice. The worker stores each conversion
before delivery and logs every request attempt with its HTTP status. A
successful response is never resent. A timeout or server failure is marked
uncertain for manual reconciliation because the PropellerAds conversion
endpoint has no application idempotency key.

Official reference: https://ssp-api.propellerads.com/v5/docs/
Official MCP: https://propellerads.com/mcp-connector/

The owner **Statistics** page also reads advertiser impressions, clicks and
spend with the saved API token. Complete POST reports in UTC are cached
for 15 minutes; read failures keep local engagement reporting available.
[Statistics setup and metric definitions](STATISTICS.md).

## Cloudflare Turnstile

Add every public landing hostname to the widget's **Hostname Management** list.
For example, if both `sparecash.leadtechx.com` and `sparecash.fit` serve the
application, authorize both hostnames on the same widget. The server accepts a
public alias only when the request Origin matches the hostname that received the
request, and it binds the Siteverify response to that hostname.

Set a hostname-restricted site key and secret. All live landings start
verification with `action=visit` and the server-issued visit ID as `cData`, even
when the visitor never subscribes. The server checks Siteverify success,
hostname, action and visit binding, then retains a 30-minute visit proof.
The widget uses interaction-only appearance. Quiz landings start it on the
visitor's first answer; pages without a quiz start it at the protected
application step. The page remains readable while it runs, and the server
requires current proof before any direct landing subscription or RoundSky
continuation. Signed follow-up links retain their delivery-token protection
because they can be opened after the original visit proof expires.
Audience verification has no test-key bypass. Legacy `action=subscribe` remains
accepted for existing clients but does not supply an audience proof.

The retargeting gate additionally requires verified engagement, no advertising
opt-out and treatment-group assignment. There is no separate consent prompt on
the landing. Provider timeouts and
expired tokens are not automatic bot evidence. Turnstile works independently
of Cloudflare DNS/CDN/WAF; no DNS migration or firewall account audit is required.
See [the retargeting contract](ENGAGEMENT-RETARGETING.md)
for settings, suppression limits, tests and deployment.

Reference: [Cloudflare server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)

## Lead time zones

In **Settings → Follow-up rules**, choose **Each lead’s time zone** or **Workspace time zone for everyone**. Set the workspace/fallback zone and the start/end hours. In **Audience → open a contact**, select a lead time zone to create an owner override. The contact view shows how its zone was obtained and the effective sending window.

Browser detection works immediately. `BROWSER_FIRST` uses the browser's named IANA zone, then trusted IP location, then the workspace fallback. `IP_FIRST` reverses the first two. IP location is approximate, particularly with VPNs and mobile networks, so browser-first is the default. No browser geolocation permission is requested. New detection priorities apply at subscription capture; stored contacts can be corrected with a manual override.

For IP-based detection on `sparecash.leadtechx.com`:

1. Proxy the domain through Cloudflare. Turnstile alone does not add IP-location headers.
2. Enable the **Add visitor location headers** Managed Transform. Cloudflare supplies `cf-timezone` using the visitor's IP location. See [Cloudflare's header reference](https://developers.cloudflare.com/rules/transform/managed-transforms/reference/#add-visitor-location-headers).
3. Enter a separate random secret of at least 32 characters in **Settings → Cloudflare → IP detection secret** (`CLOUDFLARE_GEO_TOKEN`). Keep it out of public browser code.
4. Add a [Request Header Transform Rule](https://developers.cloudflare.com/rules/transform/request-header-modification/create-dashboard/) for `http.host eq "sparecash.leadtechx.com"`. **Set static** request header `x-sparecash-geo-token` to the same secret, overwriting any incoming value. Do not add it to response headers. Cloudflare's managed `cf-timezone` header is used unchanged.
5. Wait for settings to auto-save and test a subscription through the proxied domain. With IP-first selected and the edge rule working, the CRM should report **IP location** as the source. The Settings status checks whether the secret is configured; it does not prove that Cloudflare's rules are active.

The app ignores `cf-timezone` if the matching secret is absent or incorrect. Invalid/missing zones fall back to browser or workspace detection; no external lookup request is sent by the app. Existing raw IP storage behavior is unchanged: only hashes are persisted for abuse evidence. IP detection is implemented locally but requires these account-side rules before it works on live traffic.

## Brevo

Set `BREVO_API_KEY` and a verified `BREVO_SENDER_EMAIL`. Add your real business mailing address in Settings.

Email addresses stay pending until the user explicitly confirms. Confirmations and consented follow-ups both send through Brevo's `/v3/smtp/email` endpoint. SpareCash selects the exact recipient, renders the branded HTML, includes your business address and its preference link, and adds a delivery identifier for webhook reconciliation.

Configure a transactional event webhook to:

```text
https://sparecash.leadtechx.com/api/webhooks/brevo?token=WEBHOOK_TOKEN
```

Accepted normalized fields are `event` and `email`. `unsubscribe`, `unsubscribed`, `spam`, `hard_bounce`, and `blocked` suppress the local subscription immediately. Delivery states currently track provider acceptance rather than guaranteed inbox delivery.

Reference: https://developers.brevo.com/reference/sendtransacemail

## MyEmailVerifier

Save the API key in **Settings → Provider connections → MyEmailVerifier**. The key remains server-side and masked in the owner settings response.

Every public standard or custom landing form uses the shared `/api/public/subscribe` endpoint. The submitted email first has to pass the local syntax and length checks. If an optional email field is left empty, no external request is made. When an email is present, the server checks it with MyEmailVerifier before creating a lead, subscription, follow-up enrollment, or PropellerAds Goal 3 conversion. Only a `Valid` result whose returned address matches the submitted address is accepted. An invalid result returns a correctable form error; an unavailable or malformed provider response stops the submission temporarily so an unverified address is not saved.

The email channel is offered only when MyEmailVerifier, Brevo, live delivery, and an active subscriber email chain are all configured. The connection test performs one request for MyEmailVerifier's support mailbox and consumes one validation request. Any successfully parsed status proves API access; this does not weaken the `Valid` requirement for visitor submissions.

## BlueBubbles

Set the HTTPS server URL and password in Settings. **Preferred Apple text service** selects `SMS` (default) or `iMessage`. Automated phone confirmations and follow-ups always use SMS for visitors whose source device is Android or otherwise not identified as Apple. When iMessage is selected, only visitors identified as using an iPhone, iPad, iPod, or Mac use iMessage. Owner tests use the selected service directly so each transport can be checked independently. Sending uses `/api/v1/message/text`, `method: apple-script`, and `chatGuid: SMS;-;<phone>` or `iMessage;-;<address>`. iMessage needs an iMessage-capable recipient and a working Messages account on the Mac. SMS needs Mac/iPhone Text Message Forwarding. Verify both services from Messages on the Mac before enabling campaigns. Some server/macOS versions may require an existing conversation.

The first requested message contains a short-lived confirmation code. Only confirmed phones receive marketing. OTP attempts are limited. In **Settings → Provider connections → BlueBubbles**, click **Copy reply URL**. Paste it into BlueBubbles **API & Webhooks** and enable **new-message**. The displayed URL includes the saved general webhook token:

```text
https://sparecash.leadtechx.com/api/webhooks/bluebubbles?token=WEBHOOK_TOKEN
```

The owner-only `GET /api/admin/integrations/bluebubbles/webhook` endpoint generates this URL. Save changes to the Application URL or general webhook token before copying it again.

The handler expects `data.isFromMe=false`, `data.text`, and `data.handle.address`. Incoming text from an existing SMS contact is saved in their CRM journey timeline when `data.guid` is present; the provider GUID deduplicates repeated and concurrent callbacks. Outgoing messages and unknown senders are ignored. Replies do not automatically enroll, resubscribe, or change a lead's loan status. Exact STOP, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE, and OPT OUT messages are recognized case-insensitively and cancel pending follow-ups, including on older payloads without a GUID. Do not include query-string passwords in logs. BlueBubbles does not provide a dependable provider-wide send-idempotency guarantee; uncertain attempts are held for manual resolution.

Reference: https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks

## OneSignal

Create the web push app for the same HTTPS origin. Set `ONESIGNAL_APP_ID` and the app REST API key. The worker file is `/OneSignalSDKWorker.js`; the public SDK is v16. The browser calls `login` with the server-issued lead ID, asks for permission only after the visitor chooses push, and submits the resulting subscription ID. The backend verifies that the enabled subscription appears on that OneSignal user before activation.

Push uses `include_subscription_ids` and a stable message UUID as `idempotency_key`. The push destination is a signed follow-up page, which includes preference controls. Enable OneSignal identity verification and issue login JWTs before treating external-ID association as high-assurance identity; this initial implementation checks association but does not configure account-side JWT enforcement.

Reference: https://documentation.onesignal.com/docs/en/web-sdk-reference
Reference: https://documentation.onesignal.com/reference/create-message
