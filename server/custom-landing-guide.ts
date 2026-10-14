export function customLandingGuide() {
  return {
    version: 1,
    purpose:
      "Build an original page-body fragment for an advertorial, comparison guide, visual story, quiz introduction or privacy-enhanced embedded video. SpareCash renders the protected quiz, opt-in, verification and application flow at one required slot.",
    workflow: [
      "Create and upload public artwork with create_landing_asset_upload. Use only returned /media/landing/...webp sources or exact bundled /landing-assets/... image paths returned by list_landing_assets.",
      "Author one HTML body fragment and one CSS string. Put exactly one top-level <sparecash-funnel></sparecash-funnel> between authored sections and exactly one h1 anywhere in the fragment.",
      "Call validate_custom_landing_source, then create_custom_landing_source. Sources are sanitized, content-addressed and immutable; editing means creating a new source.",
      "Set config.customLanding.sourceId to the returned id in save_experiment. Keep config.title and description as fallback metadata; questions, offerFirst and consent fields continue to configure the protected funnel.",
      "Save as DRAFT, call get_experiment, then inspect every preview URL at desktop and mobile sizes. Create a new variant when a visited variant needs a new source.",
    ],
    slot: "The funnel token must be a direct child of the submitted fragment. Content before and after it is rendered in separately scoped authored sections, so custom CSS cannot style or conceal protected controls.",
    actions:
      'Use <a href="#application"> or <button type="button" data-sc-action="open-funnel"> to scroll and focus the protected funnel. Custom forms and JavaScript are not accepted.',
    html: {
      allowed:
        "Semantic text/layout elements, tables, details/summary, local media-library images, ordinary HTTPS/mail/tel links, buttons that open the funnel, and privacy-enhanced YouTube or Vimeo iframes.",
      video:
        "Embed only https://www.youtube-nocookie.com/embed/... or https://player.vimeo.com/video/... with a descriptive title. Autoplay should be avoided.",
      blocked:
        "Scripts, inline event handlers, inline styles, forms and form controls, SVG, metadata, arbitrary embeds, external images, tracking pixels and executable URLs.",
    },
    css: {
      scope:
        "Selectors are automatically prefixed to .custom-landing-content and apply only to authored sections.",
      blocked:
        "@import, external url(), fonts, executable values, document/root selectors, protected funnel selectors, absolute/fixed/sticky overlays and z-index above 10.",
      responsive:
        "Use @media rules for mobile layouts and prefers-reduced-motion. @supports and keyframes are supported.",
    },
    protectedElements: [
      "SpareCash header identity and legal footer",
      "Server-bound Turnstile and advertising privacy controls",
      "Quiz branching and recorded answers",
      "Channel availability, consent, optional continuation and confirmation",
      "Tracked server-generated application redirect",
      "Non-lender and eligibility disclosures",
    ],
    example: {
      name: "Editorial comparison guide",
      html: `<main class="guide">
  <section class="hero">
    <p class="eyebrow">PERSONAL LOAN GUIDE</p>
    <h1>Compare the full cost, not only the monthly payment.</h1>
    <p>Use this short checklist before deciding which option fits your budget.</p>
    <button type="button" data-sc-action="open-funnel">Start with two questions</button>
  </section>
</main>
<sparecash-funnel></sparecash-funnel>
<section class="notes">
  <h2>Three details to review</h2>
  <ol><li>APR and total repayment</li><li>Fees and the amount received</li><li>Payment dates and term</li></ol>
</section>`,
      css: `.guide,.notes{max-width:72rem;margin:0 auto;padding:clamp(1.5rem,5vw,5rem)}
.hero{display:grid;gap:1.25rem;text-align:center}
.hero h1{font-size:clamp(2.5rem,7vw,5.5rem);line-height:.96;letter-spacing:-.05em}
.hero button{min-height:3.25rem;border:0;border-radius:999px;padding:0 1.5rem;background:#173f32;color:white;font:inherit;font-weight:700}
@media(max-width:700px){.guide,.notes{padding:1.25rem}}`,
    },
    limits:
      "Custom sources control presentation and editorial content, not lender decisions or application delivery. Validation enforces technical boundaries but does not prove claim accuracy, accessibility or provider availability.",
  };
}
