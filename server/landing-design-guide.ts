import { landingDesignSchema } from "./landing-design.js";
import { landingImages } from "./landing-images.js";

// Complete, validated starting points, not a fixed set of selectable templates.
// Agents may change the composition, add nodes and author entirely new trees.
export const landingDesignExamples = [
  {
    name: "Midnight poster",
    description:
      "Large display headline, dark panels and a bright call to action; form below the introduction.",
    design: landingDesignSchema.parse({
      version: 1,
      background: "#101e28",
      color: "#f4f6ec",
      font: "modern",
      headingFont: "modern",
      root: "page",
      nodes: [
        {
          id: "page",
          type: "container",
          children: ["intro", "photo", "next"],
          style: { maxWidth: 1200, padding: 40, gap: 48 },
        },
        {
          id: "intro",
          type: "container",
          children: ["label", "title", "description", "jump"],
          style: { maxWidth: 900, textAlign: "center", gap: 24 },
        },
        {
          id: "label",
          type: "text",
          text: "YOUR NEXT CHAPTER",
          style: {
            color: "#d3ef90",
            font: "mono",
            fontSize: 14,
            letterSpacing: 3,
          },
        },
        {
          id: "title",
          type: "heading",
          level: 1,
          text: "A little room. A clearer next step.",
          style: { fontSize: 88, letterSpacing: -3 },
          mobile: { fontSize: 44, letterSpacing: -1 },
        },
        {
          id: "description",
          type: "text",
          text: "Explore loan options at your pace. Compare the terms before deciding what works for you.",
          style: { maxWidth: 640 },
        },
        {
          id: "jump",
          type: "action",
          text: "Explore my next step",
          style: {
            background: "#d3ef90",
            color: "#101e28",
            radius: 48,
            maxWidth: 360,
          },
        },
        {
          id: "photo",
          type: "image",
          image: landingImages[0],
          aspect: "wide",
          style: { radius: 32 },
        },
        {
          id: "next",
          type: "container",
          children: ["form"],
          style: { maxWidth: 680 },
        },
        { id: "form", type: "funnel" },
      ],
    }),
  },
  {
    name: "Field notes",
    description:
      "Warm editorial composition with a serif headline, numbered guide and practical FAQ.",
    design: landingDesignSchema.parse({
      version: 1,
      background: "#f5eddf",
      color: "#342e28",
      font: "humanist",
      headingFont: "editorial",
      root: "page",
      nodes: [
        {
          id: "page",
          type: "container",
          children: [
            "label",
            "title",
            "rule",
            "story",
            "questions",
            "form-wrap",
          ],
          style: { maxWidth: 1120, padding: 32, gap: 32 },
        },
        {
          id: "label",
          type: "text",
          text: "SPARECASH / FIELD NOTES",
          style: { font: "mono", fontSize: 14, letterSpacing: 2 },
        },
        {
          id: "title",
          type: "heading",
          level: 1,
          text: "Before you borrow, get the whole picture.",
          style: { fontSize: 72, fontWeight: "400" },
        },
        { id: "rule", type: "divider" },
        {
          id: "story",
          type: "container",
          children: ["guide", "photo"],
          style: { columns: 2, gap: 40 },
        },
        {
          id: "guide",
          type: "container",
          children: ["intro", "steps", "jump"],
        },
        {
          id: "intro",
          type: "text",
          text: "An offer is a starting point. Take a moment to understand its costs and repayment schedule before making a decision.",
        },
        {
          id: "steps",
          type: "list",
          ordered: true,
          items: [
            "Compare the APR and total cost.",
            "Check fees and the amount you would receive.",
            "Consider whether payments fit your budget.",
          ],
        },
        {
          id: "jump",
          type: "action",
          text: "Explore available options",
          style: { borderWidth: 1, radius: 0 },
        },
        {
          id: "photo",
          type: "image",
          image: landingImages[2],
          aspect: "portrait",
        },
        {
          id: "questions",
          type: "faq",
          question: "Do I need to subscribe to continue?",
          answer:
            "No. You can continue to the application without signing up for updates.",
          style: { borderWidth: 1, padding: 24 },
        },
        {
          id: "form-wrap",
          type: "container",
          children: ["form"],
          style: { maxWidth: 720 },
        },
        { id: "form", type: "funnel" },
      ],
    }),
  },
  {
    name: "Next-step studio",
    description:
      "Compact introduction with the interactive funnel first in a two-column layout and a supporting card beside it.",
    design: landingDesignSchema.parse({
      version: 1,
      background: "#eaf0ff",
      color: "#17274d",
      font: "modern",
      headingFont: "modern",
      root: "page",
      nodes: [
        {
          id: "page",
          type: "container",
          children: ["title", "intro", "workspace"],
          style: { maxWidth: 1240, padding: 32, gap: 24 },
        },
        {
          id: "title",
          type: "heading",
          level: 1,
          text: "Start with what matters to you.",
          style: { fontSize: 56, maxWidth: 840, textAlign: "center" },
        },
        {
          id: "intro",
          type: "text",
          text: "A few preferences can help you decide on your next step. Updates are always optional.",
          style: { textAlign: "center", maxWidth: 720 },
        },
        {
          id: "workspace",
          type: "container",
          children: ["form", "card"],
          style: { columns: 2, gap: 32 },
        },
        { id: "form", type: "funnel" },
        {
          id: "card",
          type: "container",
          children: ["photo", "card-title", "list"],
          style: {
            background: "#17274d",
            color: "#ffffff",
            radius: 32,
            padding: 32,
            gap: 24,
          },
        },
        {
          id: "photo",
          type: "image",
          image: landingImages[1],
          aspect: "landscape",
          style: { radius: 20 },
        },
        {
          id: "card-title",
          type: "heading",
          level: 2,
          text: "Your decision. Your pace.",
          style: { fontSize: 36 },
        },
        {
          id: "list",
          type: "list",
          items: [
            "Review the terms before accepting an offer.",
            "Choose whether you want updates.",
            "Unsubscribe from updates whenever you like.",
          ],
        },
      ],
    }),
  },
];

export function landingDesignGuide() {
  return {
    version: 1,
    workflow: [
      "Use the design/copywriting/image-generation skills available in your own AI client. SpareCash does not install or invoke client skills, run an LLM, or generate images.",
      "Choose a distinct composition and art direction before writing the copy. Examples are starting points; you may construct a new tree with up to 80 nodes and 8 levels.",
      "Generate original images or logos, then create_landing_asset_upload and POST bytes to the returned URL. Put the returned src/alt in design image nodes; use config.logoImage for the protected header. Uploading does not attach artwork.",
      "Set config.design on save_experiment. Keep title and description as fallback metadata. The canvas replaces layout, typography, accentColor, heroImage, heroPosition, benefits and sections; use canvas nodes for those instead. Top-level questions, offerFirst, button, formTitle, formDescription and channel consent fields still control the protected funnel.",
      "Call validate_landing_design with the complete config before saving. Save as DRAFT, get_experiment for preview URLs, and check desktop and mobile previews with your browser skill. Test quiz branching, channel selection and all application paths before publishing under the owner's instructions.",
      "Create a new variant when an existing variant has visits. Change weights with set_experiment_allocation and measure with traffic_report and engagement_report.",
    ],
    composition:
      "design.root references a container. nodes is a flat list with unique IDs. Only containers have children (ordered IDs). Every node must appear exactly once in the tree. Exactly one heading with level:1 and one funnel are required. FAQ content is plain text, never a container for required controls.",
    nodeTypes: [
      "container",
      "heading",
      "text",
      "image",
      "list",
      "action",
      "faq",
      "divider",
      "funnel",
    ],
    styling:
      "Node style supports background/color/borderColor hex colors, borderWidth, radius, padding, gap, maxWidth, columns (1–4), align, textAlign, font, fontSize, fontWeight, lineHeight, letterSpacing and shadow (none/soft/bold). mobile overrides apply at <=760px. Grids wrap when a column cannot fit 280px and stack on mobile unless overridden. Numeric sizes use pixels, lineHeight is a multiplier. All text needs 4.5:1 contrast against its inherited background at both breakpoints. Read save_experiment's schema for ranges.",
    fonts: ["modern", "humanist", "editorial", "classic", "mono"],
    protectedElements: [
      "SpareCash header identity with optional custom logo",
      "Server-bound Turnstile and advertising privacy controls",
      "Exactly one working quiz/subscription/application funnel",
      "Channel consent and optional continuation",
      "Tracked server-generated application redirect",
      "Non-lender disclosure, privacy and terms links",
    ],
    actionBehavior:
      "All action nodes scroll/focus the protected funnel. They do not open external links, submit data or bypass the quiz/verification/application tracking.",
    limits:
      "This is a structured design canvas, not arbitrary HTML/CSS/JavaScript execution. No external URLs, trackers, custom forms, hidden elements, fixed positioning or overlays. Real lender approval stays with the lender. Passing validation checks structure/assets/contrast, not marketing claim accuracy or complete accessibility. Canvas examples are not live pages.",
    examples: landingDesignExamples,
  };
}
