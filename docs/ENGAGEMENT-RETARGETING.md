# Engagement and retargeting V1

SpareCash qualifies browser journeys, authorizes audience pixels and measures
first-party results. PropellerAds MCP owns campaign creation, targeting,
exclusions, budgets and advertiser statistics. V1 implements event stages;
it does not schedule day 1 → day 3 → day 7 advertiser sequences.

**Deployment status:** implemented in this branch, disabled by default. No real
pixel configuration, advertiser audience change or retargeting campaign was
created by this implementation. Production account checks remain outstanding.

## Verification and engagement

Every live quiz landing starts Turnstile on the visitor's first answer after
creating its visit; pages without a quiz start it at the protected application
step. The interaction-only widget stays out of the hero unless a visitor must
complete a challenge. This covers quiz participants and people who never
subscribe. Rendering and raw engagement remain available while verification is
incomplete; direct landing subscription, direct continuation to RoundSky, and
audience enrollment require current server-verified proof. A signed follow-up
link keeps its existing delivery-token protection so an older confirmed
subscriber is not locked out when the original 30-minute visit proof expires.

`POST /api/public/verify-visit` requires the signed visit token and matching
first-party journey cookie. Siteverify must return success, the `APP_URL`
hostname, action `visit`, and `cdata` equal to the visit ID. No local/test-key
bypass applies to audience verification. Configure real keys when testing the
flow against Cloudflare, or mock the provider in automated tests.

Cloudflare tokens are single-use and expire after five minutes; validation is
mandatory on the server. [Cloudflare validation documentation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)

The app stores a token digest, attempt outcomes and error codes, never the raw
challenge token. A retry of an already accepted token can read its same-visit
receipt while that visit's proof remains valid; it cannot transfer verification
to another visit. A new attempt becomes the current attempt, so a slow earlier
response cannot overwrite its result. Accepted app verification lasts **30
minutes**; this is distinct from Cloudflare's token lifetime. New ad clicks
require their own verification. Failures, missing keys and provider outages
leave audience enrollment closed. An invalid/expired token is not automatically
classified as bot traffic.

`POST /api/public/engagement` accepts these allowlisted events:

- `QUESTION_ANSWERED`: validates the visible answered quiz prefix against the
  immutable visit configuration. Stores the first answer per question.
- `QUIZ_COMPLETED`: derived by the server when that prefix completes a quiz path.
- `UPDATES_OPENED`: optional updates were displayed; not qualifying engagement.
- `CHANNEL_SELECTED`: the visitor chose one available update channel. It stores
  only `PUSH`, `SMS`, or `EMAIL`, never the address or telephone number. A
  verified selection qualifies the same re-engagement stage as quiz participation.
- `CONTINUE_WITHOUT_UPDATES`: recorded by `/continue` for its optional-updates CTA.
- `APPLICATION_CONTINUED`: recorded when the server creates an application click,
  for both the primary application path and the skip-updates path.

Unique `(visitId, kind, questionId)` keys prevent raw-event retry inflation. Raw
quiz events arriving before verification acquire their verified marker only
after that same visit passes server verification. Later events require a
current proof. Verification and event writes lock the visit to avoid ordering
races. Opening updates or merely loading the page never qualifies an audience.
Preview mode never creates visits, verifies visitors or loads advertising pixels.
Legacy subscription verification remains compatible with already-open clients,
but does not establish the new audience proof. Messaging consent and channel
confirmation remain separate.

`engagement_report` retains raw event measurements. `retargeting_report` separates
raw visits, latest verification states, ever-verified visits and verified
engagement, including zone grouping. Failed attempts remain in verification
history after a successful retry. No historic visits/events are backfilled as
verified audience engagement. A visit or browser journey is not a unique person
across devices.

## Audience settings and event stages

Use `save_retargeting_settings` to save audience IDs, names, purposes, enabled
status, qualifying events, application/subscription conditions, suppression
conditions and **exact account-provided pixel URLs**. Settings and changes are
stored in PostgreSQL and audited. Omitted audiences are disabled, not deleted.

Supported qualifying events are `QUIZ_PARTICIPATED`, `QUIZ_COMPLETED`,
`APPLICATION`, `SUBSCRIBED`, and `PAID`. `PAID` is reserved for a
`PAID_EXCLUSION` audience, which must only be used as a campaign exclusion.
Marketing audiences always exclude paid journeys regardless of configured rules.
Subscription conditions use confirmed, currently active subscriptions, not form
preferences or pending confirmation. Application conditions use actual
server-recorded application clicks, not opening the optional-update form.

V1 supports the provider's **HTTPS image pixel** at
`https://my.rtmark.net/img.gif`, with the supplied partner, `f` and optional
`lr=1` parameters. Enrollment accepts the account-provided `f=on` or `f=sync`;
the partner may be a legacy numeric ID or the current 64-character hexadecimal
token. Preserve the supplied enrollment URL without translating `sync` to `on`.
Removal requires `f=off` and the same exact partner. Only configure this adapter when it exactly matches the account's
code. The optional `sourceCode` field preserves the supplied snippet for review;
it is never executed. Script-only snippets, arbitrary HTML/JavaScript and other
pixel formats are rejected and need an adapter review. Audience ID and pixel
partner ID must never be assumed equal. No contact details or quiz answers are
sent to advertiser pixels.

PropellerAds documents browser removal with `f=off`, using the partner from the
original audience code. [Provider setup and removal documentation](https://help.propellerads.com/en/articles/1954798-how-to-use-propellerads-retargeting)

Use `save_retargeting_plan` for event stages with:

- `name`, `audienceId`, `excludeAudienceIds`, and linked `campaignIds`.
- `targetingChecks`: actual `targetUrl`, inclusion/exclusion readback, observation
  time and evidence reference for each campaign, obtained through PropellerAds MCP.
- `suppressionTest`: passed, testedAt and evidence reference for the end-to-end
  suppression test.
- `cloudflareAudit`: optional historical edge-security review, retained for compatibility. It does not affect readiness.

Launch validation checks that destination readbacks point to a published `/go/`
landing on `APP_URL`, preserve campaign/zone/click macros, and that RoundSky is
configured. These configuration checks do not replace a real callback test.

A campaign maps to one stage for reporting. Inclusion must contain only its
mapped audience; readback must include all configured exclusions. Each marketing
stage needs a paid-lead exclusion audience. Future-dated or older-than-seven-day
account evidence fails readiness. This is **operator-supplied evidence**, not
an independent live check by SpareCash. Re-check after changing targeting.

`validate_retargeting_setup` separates `collectionReady` (valid keys and exact
enrollment/removal pixels) from campaign launch `ready` (also requires mappings,
targeting and account-test evidence). `enabled: true` is rejected if collection
checks fail. This permits a controlled pixel/suppression test before a campaign
exists, without fabricating a passed test to unlock the test itself. Verification,
engagement, advertising opt-out and holdout checks always apply. Expired
account evidence blocks launch readiness, not existing audience collection.
SpareCash does not pause advertiser campaigns; PropellerAds MCP manages those.
Removal remains possible when collection is disabled, subject to verification
and advertising choice.

## Browser pixel approval and privacy

Landings do not display a separate advertising-consent prompt. Configured pixels
run automatically after verified qualifying actions, subject to audience rules,
setup readiness and the control group. A page view alone does not qualify.
The journey remains UNKNOWN until an actual advertising choice or privacy signal
is received; automatic tracking does not create a GRANTED consent record or
claim to verify consent on a partner site. Existing GRANTED journeys continue
to qualify, while saved DENIED choices block all advertiser pixels. Browser
Global Privacy Control and `Sec-GPC: 1` persist a DENIED choice, including when
the browser only exposes GPC through JavaScript. The existing
`/advertising-choice` endpoint retains choice history and supports already-open
clients. Email, text and push subscriptions still require their own consent.

`POST /api/public/retargeting/qualify` rechecks the signed visit, matching journey
cookie, fresh proof, verified qualifying events, subscription/application state,
paid status, current advertising choice, setup readiness and control assignment.
The browser receives only URLs the server reserved for that journey. Reservations
are serialized with privacy changes and paid-lead suppression. A repeat or
concurrent request cannot reserve the same journey/audience/action again.

The browser requests approved images with no referrer and reports `LOADED`,
`FAILED` or `UNCERTAIN` to `/retargeting/receipt`. The server initially records
`ISSUED`; an absent receipt becomes operationally uncertain, not successful.
A lost response or failed attempt is never silently retried. V1 does not reenroll
a previously removed audience automatically. Reusing an audience for a new cycle
requires a future explicit retry/study design.

**Neither an attempt nor an image load confirms audience membership.** There is
no provider membership acknowledgment implemented. Browser restrictions, blocked
scripts and ad blockers can affect matching. Loan navigation waits at most 2.5
seconds for best-effort dispatch, then continues. In-flight requests cannot be
recalled after they have reached the advertiser.

## Attribution and suppression

The signed, HttpOnly, SameSite=Lax `sc_journey` cookie lasts 90 days and links
browser visits without fingerprinting. The original journey visit supplies the
original landing angle. Each new advertising click creates its own visit and
keeps its own campaign, zone and external click ID. Campaign-to-audience mapping
is snapshotted at arrival; it is not inferred from pixel attempts.

Each RoundSky application retains its visit and a unique application ID in
`subId3`. A paid callback therefore reaches the correct journey, including
anonymous visitors who never subscribed. Existing follow-up applications remain
attributed to their originating lead/visit. Clearing cookies or switching devices
can break browser linkage; the app does not claim cross-device identity.

Application/confirmation changes refresh eligibility and mark previous audience
enrollments for suppression. `SOLD` callbacks immediately suppress further
marketing enrollment and queue suppression on prior attempts. They never request
browser pixels from the server. On a later verified browser return without an advertising opt-out,
the app can attempt the saved removal pixel and enroll the paid exclusion
audience. The configured advertiser campaign must actually exclude that audience.

Advertising withdrawal stops further ad requests, **including removal pixels**;
issuing a fresh advertiser request after refusal is not used as a workaround.
Audience removal/exclusion can therefore remain incomplete. The status report
retains suppression reasons and attempts without claiming successful removal.
The current PropellerAds MCP's inclusion/exclusion limitations must be resolved
or handled in the account before campaigns can pass launch validation.

## Reports and the control group

At the first journey, the server randomly assigns **80% treatment / 20% control**
before any audience pixels. Assignment never changes across returning clicks.
`controlPercent` can be configured before the first journey; after that, changing
it requires a separately designed new study. V1 provides one persistent study.

Both arms acquire `eligibleAt` under the same readiness, verified-engagement and
privacy rules. Controls never receive enrollment pixels. Reports compare mature
eligible journeys over the same observation window (default seven days),
including sales from original visits as well as return clicks. Recent journeys
without a full window are omitted from this comparison, not from raw reporting.
Control journeys arriving through linked retargeting campaigns are flagged as
contamination. Rate differences are descriptive, not automatic proof of lift;
inspect sample sizes, rule changes, targeting evidence and cookie loss.

`retargeting_report` groups by campaign, audience, original landing variant,
advertising zone or treatment/control group. It reports raw/verified engagement,
verified return visits, applications, confirmed subscriptions, paid leads,
commission and spend coverage. Arrival cohorts include later outcomes through
report time. The Settings panel exposes these reports and tracking failures.

Import advertiser data using `record_retargeting_spend`: one USD total per
campaign and UTC day, with the source reference. Re-imports replace totals.
Include explicit zero-spend days; missing days mean **unknown spend and unknown
acquisition cost**. Campaign spend is not added to existing click-cost imports,
and is not proportionally invented for audience, angle or control segments.
Current-day imports are provisional advertiser snapshots.

Sales and commission use the earliest `SOLD` per application (timestamp, then
record ID). Repeated sale events are flagged rather than counted twice;
`APPROVED`/`FUNDED` updates are not extra commissions. This definition is shared
by acquisition, follow-up, quiz, dashboard and experiment reports. These views
overlap: do not add reports describing the same application. Distinct application
IDs can represent distinct sales; conflicting duplicate events need review.
A sold lead does not establish that the consumer was approved or funded.

## Account setup still required

As of October 11, 2026, MCP lists `retarget-loans1` (165991), but does not expose
its pixel snippet or an audience-creation operation. The available browser opens
the PropellerAds login page. Obtain account access, then create dedicated quiz,
application and paid-exclusion audiences and copy their exact **Get code** pixels.
No placeholder test IDs from the automated tests should be used in production.

Cloudflare DNS, proxy/CDN, WAF and an account audit are **not required**.
Turnstile works with the owner's existing DNS and hosting. Require the widget's
production keys, successful server-side Siteverify validation, the expected
hostname/action/visit binding and verified engagement before audience enrollment.
Advertising opt-out and holdout checks also remain mandatory. Optional edge
protection is a separate operational choice, not a retargeting launch gate.
[Cloudflare Turnstile overview](https://developers.cloudflare.com/turnstile/)

Finish the account audience setup and save disabled settings. Enable collection
only when deliberately testing/collecting verified qualifying actions; no ad
campaign needs to be active. Test the browser/callback/removal path. Create
**draft** campaigns in PropellerAds MCP, read back targeting and test exclusions,
then record the actual evidence and run launch validation. SpareCash must never record a passed test just to clear a gap.
Live campaign activation remains a separate advertiser action.

No bot filter guarantees 100% human traffic. Blocking after arrival does not
guarantee the original advertising click was free or refundable. Preserve raw
rejected traffic and use advertiser billing records for cost measurement.

## Deployment and acceptance

Deploy web/worker code containing migrations `202610110001_retargeting` and
`202610110002_verified_engagement`, after PR #2's engagement migration. The normal
Docker entrypoint runs migrations. No new environment variables or persistent
file storage are required. Reconnect MCP to discover the new tools.

Automated tests cover strict proof binding, replay/expiry, pending raw events,
privacy/GPC, controls, concurrent dispatch, receipts, application progression,
return attribution, anonymous paid callbacks, sale/spend deduplication and equal
control observation windows. Mobile browser checks use mocked provider responses
and image requests, so they do not establish real audience membership. Complete
the documented account and suppression checks before launch.

Retention/deletion procedures must cover VisitorJourney, AdvertisingPrivacyEvent,
VisitorVerification, RetargetingPixelAttempt and VisitEvent. Deleting a journey
cascades its privacy/pixel history and unlinks its visits; deleting a visit removes
its event/verification history. No historical control or verification backfill is
performed by the migrations.
