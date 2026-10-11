export const propellerContextParameters = {
  bannerId: "banner_id",
  browser: "browser",
  browserVersion: "browser_version",
  carrier: "carrier",
  propellerClickId: "propeller_click_id",
  connectionType: "connection_type",
  declaredCost: "cost",
  country: "country",
  device: "device",
  language: "language",
  os: "os",
  osVersion: "os_version",
  region: "region",
  subzoneId: "subzone_id",
  userAgent: "advertiser_user_agent",
  utmSource: "utm_source",
  utmMedium: "utm_medium",
  utmCampaign: "utm_campaign",
  utmContent: "utm_content",
} as const;

export type PropellerAdContext = Partial<
  Record<keyof typeof propellerContextParameters, string>
>;

export function propellerVisitAttribution(search: string) {
  const query = new URLSearchParams(search);
  const value = (name: string) => query.get(name) || undefined;
  const adContext: PropellerAdContext = {};
  for (const [key, name] of Object.entries(propellerContextParameters)) {
    const current = value(name);
    if (current) adContext[key as keyof PropellerAdContext] = current;
  }
  return {
    campaignId: value("campaign_id"),
    zoneId: value("zone_id"),
    clickId: value("click_id"),
    adContext,
  };
}

const propellerMacros = [
  ["campaign_id", "{campaign_id}"],
  ["zone_id", "{zone_id}"],
  ["click_id", "${SUBID}"],
  ["banner_id", "{bannerid}"],
  ["browser", "{browser}"],
  ["browser_version", "{browser_version}"],
  ["carrier", "{carrier}"],
  ["propeller_click_id", "{clickID}"],
  ["connection_type", "{connection_type}"],
  ["cost", "{cost}"],
  ["country", "{country}"],
  ["device", "{device}"],
  ["language", "{language}"],
  ["os", "{os}"],
  ["os_version", "{osversion}"],
  ["region", "{region}"],
  ["subzone_id", "{subzone_id}"],
  ["advertiser_user_agent", "{useragent}"],
] as const;

export function propellerTargetUrl(
  baseUrl: string,
  campaign: string,
  medium = "push",
) {
  const separator = baseUrl.includes("?") ? "&" : "?";
  const parameters = [
    ...propellerMacros,
    ["utm_source", "propellerads"],
    ["utm_medium", medium],
    ["utm_campaign", encodeURIComponent(campaign)],
    ["utm_content", "{bannerid}"],
  ];
  return `${baseUrl}${separator}${parameters
    .map(([name, value]) => `${name}=${value}`)
    .join("&")}`;
}
