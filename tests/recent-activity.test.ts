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
      { location: "Nashville, TN", amount: "$1,000–$2,500" },
      { location: "the U.S." },
    ]);
  });

  it("formats a validated custom-form amount and state", () => {
    const customConfig = landingSchema.parse({
      title: "W-2 personal loan finder",
      description: "Choose two details and check your next step.",
      customLanding: { sourceId: "cmabcdefghijklmnopqrstuv" },
      customForm: {
        fields: [
          {
            id: "amount",
            valueType: "integer",
            required: true,
            min: 500,
            max: 50000,
            step: 500,
            defaultValue: 5000,
          },
        ],
        contacts: { email: "required" },
      },
    });

    expect(
      publicRecentActivity([
        {
          lead: { answers: { amount: "5000" } },
          visit: {
            city: null,
            region: "Texas",
            adContext: {},
            configSnapshot: customConfig,
            engagementEvents: [],
          },
        },
        {
          lead: { answers: { amount: "5250" } },
          visit: {
            city: null,
            region: "TX",
            adContext: {},
            configSnapshot: customConfig,
            engagementEvents: [],
          },
        },
      ]),
    ).toEqual([
      { location: "TX", amount: "$5,000" },
      { location: "TX" },
    ]);
  });
});
