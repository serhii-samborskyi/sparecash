# Opt-in and engagement tracking

The optional-update form begins with channel choices. First name is optional;
contact fields, age/residency confirmation, consent and the verification challenge
appear after a channel is selected. Browser notifications use a plain-language
label. A separate **Continue to application** button remains available without
subscribing. Existing channel-specific consent and confirmation rules still apply.

## First-party events

`POST /api/public/engagement` accepts a signed visit token and an allowlisted event:

- `QUESTION_ANSWERED`: validates the visible answered quiz prefix against the
  configuration snapshot from the original visit. Stores one event per question.
- `QUIZ_COMPLETED`: recorded by the server when that prefix completes a visible
  quiz path. This is a historical action, not the final submitted lead response.
- `UPDATES_OPENED`: the optional-update form was shown.
- `CONTINUE_WITHOUT_UPDATES`: recorded in `/api/public/continue` when the visitor
  clicks **Continue to application** inside the optional-update form. The primary
  application CTA is recorded as an application click but not as an opt-in skip.

Unique `(visitId, kind, questionId)` keys prevent retry inflation. Events retain
the first recorded answer and timestamp; submitted lead answers remain separate.
The client dispatches small keepalive requests immediately and does not block
navigation on analytics. Browser/network failures can still lose client events.
Skip events are stored server-side before returning the application URL.

Preview mode sends no events or applications. Engagement creates no subscription,
does not mark a visitor verified, and calls no advertising or messaging provider.
It is self-reported activity, not proof of identity or lender qualification.
Counts represent visit sessions, not unique people across devices. There is no
historical backfill or page-view/scroll/time-on-page event collection.

Use experiment results for all-time per-variant counts. MCP `engagement_report`
adds a visit-cohort date window, campaign/zone filters, application visitors and
confirmed opt-in visitors. It defaults to the last 30 days excluding the newest
24 hours; use `minimumAgeHours: 0` to inspect recent events. The owner endpoint is
`GET /api/admin/experiments/:id/engagement`.

`list_traffic_visits` accepts `engagementKind` and returns event markers alongside
existing attribution/click IDs, without contact details or quiz answer values.
No list is automatically uploaded to an advertiser. Existing retention/deletion
procedures should include `VisitEvent`; deleting a visit cascades its events.

## PropellerAds feasibility — checked October 10, 2026

PropellerAds documents three audience sources: ad clicks, conversions reported
through S2S, and website retargeting pixels. Click-based audiences include all ad
clickers, so they cannot by themselves identify quiz participants or opt-in skips.
Website pixels can be placed on the relevant page or fired after the corresponding
action to collect an engagement audience; event-triggering is the proposed site
integration, not a documented arbitrary server-side audience-upload API.

The connected account exposes audience **retarget-loans1 (165991)** through
`get_targeting_list(targeting_type="audience")`. The available MCP tools and
public SSP specification do not expose its pixel snippet or audience creation.
The audience's ID must not be guessed to be the pixel's `partner` identifier.
Copy the exact snippet from the account's audience **Get code** action first.

Suggested segments after account setup:

1. Quiz participants (at least one valid answer).
2. Visitors who continue without updates.
3. A separate confirmed-conversion audience to exclude from relevant reminders.

Use generic engagement signals for ad audiences; do not send names, contact
details or loan-answer values to the pixel. Advertising privacy choices and
applicable opt-outs need their own handling: skipping email/SMS/push updates
does not grant advertising-tracking permission. Browser restrictions and ad
blockers can prevent pixel matching, so first-party event totals and audience
sizes will not necessarily match. S2S callbacks alone cannot execute a browser
pixel to remove a visitor after a later asynchronous sale.

The S2S documentation supports `goal=2` and `goal=3` for secondary events and says
only the main event affects CPA Goal optimization. It does not establish which
goals populate the converted-users audience or support separate per-goal
audiences. Keep the purchased-lead conversion separate from engagement; confirm
that account behavior before using a secondary goal as an audience source.

No PropellerAds pixel, S2S engagement postback, audience membership change or
retargeting campaign is enabled by this release. Campaigns remain drafts.

Sources:

- [PropellerAds Audiences 2.0](https://help.propellerads.com/en/articles/4240694-audiences-2-0)
- [Website retargeting and pixel setup](https://help.propellerads.com/en/articles/1954798-how-to-use-propellerads-retargeting)
- [S2S conversion tracking and secondary goals](https://help.propellerads.com/en/articles/1954809-how-to-integrate-propellerads-s2s-conversion-tracking)
- [Public SSP API specification](https://ssp-api.propellerads.com/v5/docs/)

## Deployment

Deploy the web/worker image containing migration
`202610100002_visit_engagement`. The normal container entrypoint applies it.
Reconnect MCP to discover `engagement_report` and the new visit filter. Existing
variants, weights, hero images, logos and message-chain settings are preserved.
