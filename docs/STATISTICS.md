# Acquisition statistics

Open **Statistics** in the owner workspace (`/admin/statistics`). The initial
view compares zones over the last seven UTC days, including today. Choose up to
93 days, sort a metric, search rows, require a minimum visit sample, or export
all matching rows as CSV. Table search and minimum visits affect rows/export;
the summary cards retain the full report scope. Row arrows add the segment to
the report filters: campaign → zones, country → states, state → cities, and
other segments → landing variants.

Available breakdowns: campaign + zone, campaign, landing variant, country,
state/region, city, device, browser, operating system, and UTC day. City keys
include country and state so identically named cities are not combined.
Filters can combine dates, campaign, zone, landing, country, state, city,
device, browser and operating system. Unknown dimensions remain visible.

Select a nonzero **Visits** value to open the matching visit records. The
paginated explorer preserves the current date range, report filters and exact
row key, including unattributed and provider-macro breakdowns. Its collapsed
rows show arrival time, traffic source, landing, visitor context, quality,
pre-quiz activity and furthest outcome. Expand one to inspect stored
attribution macros, verification evidence and attempts, the event/answer
timeline, subscription states, application postbacks, advertiser conversion
feedback and retargeting activity.

## Metrics

| Metric                           | Definition                                                                                                                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Billed ad clicks                 | Clicks reported by PropellerAds for the selected campaign, zone and UTC day.                                                                                                                   |
| Server hits                      | Requests received on `/go/<slug>` before browser JavaScript runs. Repeat loads count again.                                                                                                    |
| JS visits                        | Recorded visit sessions after the application loads, not unique people. Each new advertiser click can produce another visit.                                                                   |
| Click → server / server → JS     | Server hits divided by billed clicks, and JS visits divided by server hits. These expose delivery loss separately from browser-render loss.                                                    |
| Ad CTR                           | PropellerAds clicks divided by impressions. Aggregates recompute the ratio from totals.                                                                                                        |
| Verified                         | Visit's latest recorded browser verification passed, including legacy verified visits. This is a quality signal, not certain human identity.                                                   |
| Suspected bots                   | Unverified visits with bot score ≥70 from recorded abuse evidence.                                                                                                                             |
| Unverified                       | Remaining visits. Pending/failed/expired checks or provider errors alone do not prove bot activity.                                                                                            |
| Engagement                       | Unique visits with a quiz answer, an application click recorded by the server, or a confirmed subscription, divided by visits. Multiple actions count once. Opening updates alone is excluded. |
| Pre-quiz time                    | Average time the page was visible before the first quiz answer, plus total measured time. Older unmeasured visits are excluded from the average instead of counted as zero.                    |
| Pre-quiz activity                | Meaningful control clicks outside the quiz and separate scroll gestures before the first quiz answer. Also shows active and measured visit counts.                                             |
| Verified engagement              | Engaged visits whose verification flag is true, divided by verified visits.                                                                                                                    |
| Quiz completion                  | Visits with a completed quiz divided by visits that answered a question.                                                                                                                       |
| Application rate                 | Visits with at least one recorded application click divided by visits. It is not completed lender applications.                                                                                |
| Subscription rate                | Visits with at least one confirmed subscription divided by visits. Multiple channels count once; later opt-outs remain in the historical rate.                                                 |
| Email/text/push                  | Unique confirmed visits for each channel. Channel counts overlap.                                                                                                                              |
| Active subscribers               | Visits with at least one currently active, confirmed subscription.                                                                                                                             |
| Purchased leads and commission   | Earliest SOLD per application, including follow-ups attributed to their original acquisition visit. Duplicate SOLD callbacks do not multiply revenue. SOLD is not approval or funding.         |
| Ad spend/CPC                     | Read from PropellerAds; CPC is spend divided by advertiser clicks.                                                                                                                             |
| Cost/visit, quiz, application    | PropellerAds spend divided by JS visits, quiz completions, or unique application visitors.                                                                                                     |
| Cost/subscriber, cost/sale, ROAS | Calculated only when advertiser reporting scopes match every visit in the row. Missing costs or unmatched visits leave these blank.                                                            |
| Recorded click costs             | Existing per-visit cost records, displayed separately and never added to advertiser spend.                                                                                                     |

All visit-based rates use the denominator shown in the table. Empty
denominators and unavailable values are `—`, never fabricated zeros. A small
sample marker appears below 30 visits; this is a reading aid, not a statistical
significance test. The three traffic-quality groups are mutually exclusive.

Visits and advertiser activity use the selected UTC window. Confirmations and
sales for those visits are observed through report time. Recent traffic has
had less time to convert. This view is descriptive; it never changes bids,
budgets, campaign status or zone exclusions automatically.

## PropellerAds connection

Use the saved **Integrations → PropellerAds** API token. The app sends
`POST /adv/statistics` with `group_by` set to campaign, zone, country, and day,
an explicit `tz=+0000`, and inclusive date/time boundaries. It validates the
complete returned result before storing a snapshot. Country names such as
`United States (US)` are normalized to their country code. Provider-returned
rows must match the requested dates/campaigns/zone/country. See the
[official statistics API](https://ssp-api.propellerads.com/v5/docs/).

By default, advertiser requests cover campaigns already attributed to local
traffic sources. An explicit campaign filter can load a campaign with no
recorded local visits. Zones that have impressions/clicks but no tracked visits
still appear. Advertiser clicks, server landing hits, rendered visits and
verified visits are independent measurements and may differ. Server hits are
available for zone, campaign and UTC-day views. Each hit is linked to the
rendered visit when the browser reaches the visit endpoint, which also makes
the raw hit visible in the visit-detail explorer.

Complete snapshots live in `AdStatisticsSnapshot` and are reused for 15 minutes
while browsing. **Refresh** requests a new read. Overlapping identical requests
share one fetch within the web process. A failed refresh can display an older
complete snapshot, clearly marked with its timestamp. Partial/oversized reports
are never accepted as complete. Credentials are never included in responses or
stored snapshot queries; changes to the API token invalidate the cache key.

Ad CTR and spend are joined only for zone, campaign, country and day breakdowns
without landing/state/city/device/browser/OS filters. This integration joins
advertiser data at campaign/zone/country/day granularity. Ad metrics for finer
local slices remain unavailable rather than proportionally allocating spend
or inventing CTR.
Current-day data can change during reporting. Imported retargeting spend and
recorded visit costs are separate sources and are not added to these snapshots.

## Geography and device capture

New visits store country, state/region, city and `geoSource=TRUSTED_EDGE` only
when incoming location headers carry the configured `x-sparecash-geo-token`.
The existing **Integrations → Cloudflare → IP detection secret** and trusted
edge rule are reused. The app reads `cf-ipcountry`, `cf-region` and `cf-ipcity`;
only a valid country permits storing the region/city. No raw IP, coordinates,
browser location-permission prompt, or external IP lookup is added.

Cloudflare's **Add visitor location headers** Managed Transform supplies these
headers; follow the existing [location setup](INTEGRATIONS.md#lead-time-zones)
and [Cloudflare header reference](https://developers.cloudflare.com/rules/transform/managed-transforms/reference/#add-visitor-location-headers).
The secret's presence alone does not establish that the edge rule is working.
Check the location coverage shown above the table. Location is approximate and
can reflect a VPN. Previously hashed IP addresses cannot recover historic
cities; those visits stay unknown.

Device, browser and OS are coarse categories derived from the user agent
already stored on a visit. They work for historical visits as well. These are
client claims and do not increase a visit's verification or bot score.

## API, deployment and limits

Owner-only `POST /api/admin/statistics/report` and MCP `statistics_report` accept
the same aggregate filters. Date strings are `YYYY-MM-DD`; MCP defaults to 30
days and the app supplies its selected dates. Both use the same calculation
service. The aggregate owner endpoint retains authentication, origin checks and
a 20 requests/minute limit.

The owner-only `POST /api/admin/statistics/visits` endpoint powers the click
explorer. It additionally requires the selected group and exact segment key,
returns up to 50 visits per page in the interface, and is limited to 30
requests/minute. It can return lead names and raw user agents needed for owner
diagnosis. It deliberately excludes IP hashes, verification token hashes and
subscription addresses. The service scans at most 50,000 candidate visits so
macro, device and unknown-value rows match the aggregate report exactly.

Deploy migrations `202610110003_traffic_statistics`,
`202610130002_prequiz_activity`, and
`202610150001_server_hits_and_conversion_goals` with the web and worker
release; the standard
Docker startup applies them. The latter stores cumulative first-party visible
time, meaningful click and scroll counters on each visit. There is no
historical behavior backfill or new required environment variable. Reconnect
MCP clients to discover the latest `statistics_report` fields.

Reports reject more than 50,000 matching visits or advertiser rows rather than
silently truncating totals. Narrow the dates or campaign if this limit is
reached. Geography/state/device filters can disable advertiser comparison;
the app explains this next to the table. CSV includes all numeric metrics,
represents rate values as decimals, leaves missing values blank, and escapes
spreadsheet formula prefixes in text labels.
