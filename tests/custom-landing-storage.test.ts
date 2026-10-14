import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "../server/db";
import {
  createCustomLandingSource,
  getCustomLandingSource,
  hydrateCustomLandingConfig,
} from "../server/services/custom-landings";
import { saveExperiment } from "../server/services/control";
import { getExperiment } from "../server/services/marketing";
import { landingSchema } from "../server/domain";

describe("custom landing storage", () => {
  it("keeps immutable source content behind an experiment reference and hydrates previews", async () => {
    const marker = randomUUID();
    const source = await createCustomLandingSource(
      {
        name: `Storage test ${marker}`,
        html: `<main><h1>Storage test ${marker} in {{city}}{{region_phrase}}</h1></main><sparecash-funnel></sparecash-funnel><section><h2>Details</h2></section>`,
        css: "main,section{max-width:60rem;margin:0 auto}",
      },
      "test",
    );
    let experimentId = "";
    try {
      const experiment = await saveExperiment(
        {
          name: `Custom source ${marker}`,
          slug: `custom-source-${marker}`,
          status: "DRAFT",
          objective: "SUBSCRIPTIONS",
          variants: [
            {
              name: "Custom page",
              weight: 100,
              config: {
                title:
                  "Custom source storage test in {{city}}{{region_phrase}}",
                description:
                  "A fallback description used when the custom source is unavailable.",
                cityFallback: "Houston",
                regionFallback: "Texas",
                customLanding: { sourceId: source.id },
                questions: [
                  {
                    id: "timing",
                    label: "When are you comparing options?",
                    options: ["Today", "This week"],
                  },
                ],
              },
            },
          ],
        },
        "test",
      );
      experimentId = experiment.id;
      expect(experiment.variants[0].config).toMatchObject({
        customLanding: { sourceId: source.id },
      });
      expect(JSON.stringify(experiment.variants[0].config)).not.toContain(
        marker,
      );

      const hydrated = await getExperiment(experiment.id);
      expect(hydrated.propellerUrl).toContain("city=Houston");
      expect(hydrated.variants[0].config.customLanding).toMatchObject({
        sourceId: source.id,
        name: `Storage test ${marker}`,
      });
      expect(hydrated.variants[0].config.customLanding?.htmlBefore).toContain(
        marker,
      );
      expect(hydrated.variants[0].config.title).toContain(
        "in Houston in Texas",
      );
      expect(hydrated.variants[0].config.customLanding?.htmlBefore).toContain(
        "in Houston in Texas",
      );
      expect(
        hydrated.variants[0].config.customLanding?.htmlBefore,
      ).not.toContain("{{city}}");
      const personalized = await hydrateCustomLandingConfig(
        landingSchema.parse(experiment.variants[0].config),
        { city: "St. Louis", region: "Missouri" },
      );
      expect(personalized.title).toContain("St. Louis");
      expect(personalized.customLanding?.htmlBefore).toContain(
        "in St. Louis in Missouri",
      );
      const generic = await hydrateCustomLandingConfig(
        landingSchema.parse({
          title: "Explore loan options{{region_phrase}}",
          description: "Compare a possible next step without location copy.",
        }),
      );
      expect(generic.title).toBe("Explore loan options");
      expect(hydrated.variants[0].config.questions).toHaveLength(1);
      const reusable = await getCustomLandingSource(source.id);
      expect(reusable.html).toContain("<sparecash-funnel></sparecash-funnel>");
      expect(reusable.html).toContain(marker);
      expect(reusable.reference).toEqual({ sourceId: source.id });
    } finally {
      if (experimentId) {
        await db.variant.deleteMany({ where: { experimentId } });
        await db.experiment.delete({ where: { id: experimentId } });
      }
      await db.landingSource.deleteMany({ where: { id: source.id } });
    }
  });
});
