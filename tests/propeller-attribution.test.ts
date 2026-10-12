import { describe, expect, it } from "vitest";
import {
  propellerTargetUrl,
  propellerVisitAttribution,
} from "../shared/propeller-attribution";

describe("PropellerAds attribution", () => {
  it("builds a target URL containing every push CPC token", () => {
    const url = propellerTargetUrl(
      "https://sparecash.example/go/loan-checklist",
      "loan-checklist",
    );
    for (const token of [
      "campaign_id={campaign_id}",
      "zone_id={zone_id}",
      "click_id=${SUBID}",
      "banner_id={bannerid}",
      "browser={browser}",
      "browser_version={browser_version}",
      "carrier={carrier}",
      "connection_type={connection_type}",
      "cost={cost}",
      "country={country}",
      "device={device}",
      "language={language}",
      "os={os}",
      "os_version={osversion}",
      "region={region}",
      "subzone_id={subzone_id}",
      "advertiser_user_agent={useragent}",
    ])
      expect(url).toContain(token);
    expect(url).toContain("utm_source=propellerads");
    expect(url).not.toContain("%7B");
    expect(url).not.toContain("{clickID}");
  });

  it("maps target URL parameters into the visit payload", () => {
    expect(
      propellerVisitAttribution(
        "?campaign_id=11991783&zone_id=42&click_id=conversion-id" +
          "&banner_id=27516444&browser=Chrome&browser_version=130" +
          "&carrier=Verizon&propeller_click_id=click-id&connection_type=cellular" +
          "&cost=0.031&country=US&device=Mobile&language=en&os=Android" +
          "&os_version=15&region=Illinois&subzone_id=7" +
          "&advertiser_user_agent=Mozilla%2F5.0&utm_source=propellerads" +
          "&utm_medium=push&utm_campaign=loan-checklist&utm_content=27516444",
      ),
    ).toEqual({
      campaignId: "11991783",
      zoneId: "42",
      clickId: "conversion-id",
      adContext: {
        bannerId: "27516444",
        browser: "Chrome",
        browserVersion: "130",
        carrier: "Verizon",
        propellerClickId: "click-id",
        connectionType: "cellular",
        declaredCost: "0.031",
        country: "US",
        device: "Mobile",
        language: "en",
        os: "Android",
        osVersion: "15",
        region: "Illinois",
        subzoneId: "7",
        userAgent: "Mozilla/5.0",
        utmSource: "propellerads",
        utmMedium: "push",
        utmCampaign: "loan-checklist",
        utmContent: "27516444",
      },
    });
  });
});
