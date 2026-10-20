export function customLandingGuide() {
  return {
    version: 2,
    purpose:
      "Create independent HTML/CSS landings whose presentation is fully authored while SpareCash owns validation, attribution, engagement events, contact consent, subscriptions and application handoff.",
    modes: {
      boundForm:
        'For a unique form page, author exactly one <form data-sc-form="lead"> and no sparecash-funnel slot. Declare its data contract in config.customForm.',
      legacy:
        "Existing editorial pages remain supported with exactly one top-level <sparecash-funnel></sparecash-funnel>. They continue to use the protected fixed funnel.",
    },
    workflow: [
      "Decide the fields, their validation and the contact requirements for this landing. The requested workflow belongs in config.customForm, not a global quiz template.",
      "Author the complete form layout in HTML and CSS using the bindings below. Custom colors, card structure, sliders, copy and responsive layout are permitted.",
      "Call validate_custom_landing_source and create_custom_landing_source. Reference the returned source id from config.customLanding.sourceId and include the matching config.customForm.",
      "Save a DRAFT or zero-weight variant, inspect desktop and mobile previews, then assign traffic. Sources are immutable, so design edits create a new source.",
    ],
    bindings: {
      form: '<form data-sc-form="lead">',
      field:
        '<input data-sc-field="amount"> binds a value defined in customForm.fields.',
      contact:
        '<input data-sc-contact="phone|name|email"> binds a non-hidden customForm.contacts entry.',
      output:
        '<output data-sc-output="amount" data-sc-format="currency"> mirrors a bound field. Omit the format for plain text or numbers.',
      submit:
        '<button data-sc-action="submit"> submits through the SpareCash workflow.',
      errors:
        "Add one element with data-sc-errors for validation, verification and delivery messages.",
      consent:
        "Add an element with data-sc-consent whenever phone or email is collected. SpareCash automatically inserts its required calls-and-messages toggle there whenever the form collects a phone number; keep Terms, Privacy Policy and any email disclosure in the authored element.",
      activity:
        'An optional data-sc-activity container may contain data-sc-bind="location" and data-sc-bind="amount". SpareCash fills it only from anonymized recent activity and hides it when none exists.',
      matchEstimate:
        "When customForm.matchEstimate is configured, data-sc-match-percent and data-sc-match-strength receive the clearly labeled estimate. Wrap the ordinary page in data-sc-form-view.",
      providerSearch:
        'When customForm.providerSearch is configured, add a hidden data-sc-provider-search stage with data-sc-provider-count, data-sc-provider-progress, data-sc-provider-status and a data-sc-action="continue" button. SpareCash controls timing and application handoff.',
    },
    configExample: {
      customForm: {
        fields: [
          {
            id: "amount",
            valueType: "integer",
            required: true,
            min: 500,
            max: 50000,
            step: 500,
            defaultValue: 10000,
          },
          {
            id: "term_days",
            valueType: "integer",
            required: true,
            min: 7,
            max: 30,
            step: 1,
            defaultValue: 15,
          },
        ],
        contacts: { name: "optional", phone: "required", email: "optional" },
        continueToApplication: true,
        matchEstimate: {
          amountFieldId: "amount",
          scoreFieldId: "credit_score",
        },
        providerSearch: {
          minDurationMs: 5000,
          maxDurationMs: 10000,
          minProviderCount: 104,
          maxProviderCount: 135,
        },
      },
    },
    htmlExample: `<main class="request-page">
  <h1>Check personal loan options</h1>
  <form class="request-card" data-sc-form="lead">
    <label for="amount">Loan amount</label>
    <output data-sc-output="amount" data-sc-format="currency"></output>
    <input id="amount" type="range" data-sc-field="amount">
    <label for="term">Loan term</label>
    <output data-sc-output="term_days"></output>
    <input id="term" type="range" data-sc-field="term_days">
    <input type="text" data-sc-contact="name" autocomplete="name" placeholder="Your name (optional)">
    <input type="tel" data-sc-contact="phone" autocomplete="tel" placeholder="Mobile number">
    <input type="email" data-sc-contact="email" autocomplete="email" placeholder="Email (optional)">
    <div data-sc-consent>By continuing, you accept the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>. The required calls-and-messages toggle is inserted here automatically when a phone number is collected.</div>
    <p data-sc-errors role="alert"></p>
    <button type="submit" data-sc-action="submit">Check my loan options</button>
  </form>
</main>`,
    personalization:
      "Use {{region_phrase}} where location is optional. It becomes ' in Texas' when a trusted region exists and an empty string otherwise. Use {{city}} only when the sentence remains natural with the fallback 'your area'.",
    security:
      "JavaScript, inline handlers/styles, arbitrary embeds and external images remain blocked. Supported inputs are range, text, tel and email. The server overrides required/min/max/step/default constraints from customForm and revalidates every submission.",
    css: "CSS is scoped to .custom-landing-content. Media queries, supports rules and keyframes are allowed. External url() loads and document/root selectors are blocked. A data-sc-activity selector may use fixed or absolute positioning with z-index up to 10; other overlays remain blocked.",
  };
}
