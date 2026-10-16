import { describe, expect, it } from "vitest";
import { landingSchema } from "../server/domain";
import { publicRecentActivity } from "../server/services/recent-activity";

const config = landingSchema.parse({
  title: "W-2 personal loan finder",
  description: "Choose two details and check your next step.",
  questions: [
    {
      id: "amount",
      label: "How much are you considering?",
      options: ["Under $1,000", "$1,000–$2,500"],
    },
  ],
});

describe("public recent application activity", () => {
  it("keeps only anonymized, validated location and amount copy", () => {
    expect(
      publicRecentActivity([
        {
          lead: { answers: { amount: "$1,000–$2,500" } },
          visit: {
            city: "Nashville",
            region: "Tennessee",
            adContext: {},
            configSnapshot: config,
            engagementEvents: [],
          },
        },
        {
          lead: { answers: { amount: "<script>bad</script>" } },
          visit: {
            city: "<b>Chicago</b>",
            region: null,
            adContext: {},
            configSnapshot: config,
            engagementEvents: [],
          },
        },
      ]),
    ).toEqual([
      { location: "Nashville", amount: "$1,000–$2,500" },
      { location: "the U.S." },
    ]);
  });
});
