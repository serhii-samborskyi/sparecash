import { initializeRuntimeConfiguration } from "../server/runtime-config.js";
import { db } from "../server/db.js";
import { landingSchema, settingsSchema } from "../server/domain.js";
await db.setting.upsert({
  where: { key: "general" },
  create: { key: "general", value: settingsSchema.parse({}) },
  update: {},
});
if (!(await db.experiment.findUnique({ where: { slug: "us-loans" } })))
  await db.experiment.create({
    data: {
      name: "A little breathing room",
      slug: "us-loans",
      status: "DRAFT",
      objective: "SUBSCRIPTIONS",
      variants: {
        create: [
          {
            name: "A softer introduction",
            weight: 50,
            config: landingSchema.parse({
              title: "A little more room for what matters.",
              description:
                "Explore loan options, on your terms. Tell us what you’re looking for and choose how you’d like to hear from us.",
            }),
          },
          {
            name: "A quick conversation",
            weight: 50,
            config: landingSchema.parse({
              title: "Let’s find your next step.",
              description:
                "Answer a couple of quick questions, then choose how you’d like to hear about loan options.",
              theme: "blue",
              questions: [
                {
                  id: "amount",
                  label: "How much are you looking for?",
                  options: [
                    "Under $1,000",
                    "$1,000–$2,500",
                    "$2,500–$5,000",
                    "Over $5,000",
                  ],
                },
                {
                  id: "timing",
                  label: "When would a loan be helpful?",
                  options: [
                    "As soon as possible",
                    "In the next few weeks",
                    "I’m exploring options",
                  ],
                },
              ],
            }),
          },
        ],
      },
    },
  });
for (const channel of ["EMAIL", "SMS", "PUSH"] as const) {
  if (
    !(await db.chain.findFirst({
      where: {
        name: `${channel === "EMAIL" ? "Email" : channel === "SMS" ? "Text" : "Push"} · a thoughtful start`,
      },
    }))
  )
    await db.chain.create({
      data: {
        name: `${channel === "EMAIL" ? "Email" : channel === "SMS" ? "Text" : "Push"} · a thoughtful start`,
        channel,
        status: "DRAFT",
        trigger: "SUBSCRIBED",
        maxDays: 30,
        steps: {
          create: [
            {
              position: 0,
              delayHours: 24,
              subject: "A next step, when you’re ready",
              body: "Hi {{name}}, take a look at loan options when the time is right for you. Review any lender’s terms before deciding. {{link}}",
            },
            {
              position: 1,
              delayHours: 24,
              subject: "A little preparation goes a long way",
              body: "Hi {{name}}, knowing your monthly budget can help you consider what payments may fit. Explore your options here: {{link}}",
            },
            {
              position: 2,
              delayHours: 24,
              subject: "Keep your choices open",
              body: "Hi {{name}}, still exploring? You can revisit loan options here. Approval and terms are determined by the lender. {{link}}",
            },
          ],
        },
      },
    });
}
await initializeRuntimeConfiguration();
await db.$disconnect();
