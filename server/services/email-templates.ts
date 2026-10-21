import type { EmailTemplate } from "@prisma/client";
import sanitizeHtml from "sanitize-html";
import { db } from "../db.js";
import { emailTemplateSchema, escapeHtml, renderMessage } from "../domain.js";
import { audit } from "./control.js";
import { env } from "../config.js";

const presets = [
  {
    id: "email_template_options",
    name: "Loan options · clean",
    status: "ACTIVE" as const,
    subject: "Your next step, {{name}}",
    preheader: "Review personal-loan options when you are ready.",
    eyebrow: "YOUR LOAN OPTIONS",
    headline: "A clearer next step",
    body: "Hi {{name}}, your loan-options link is ready. Compare the terms, payment schedule, and total cost before deciding.",
    ctaLabel: "Explore loan options",
    accentColor: "#1f5b4d",
  },
  {
    id: "email_template_payday",
    name: "Before payday · warm",
    status: "ACTIVE" as const,
    subject: "Still waiting for payday, {{name}}?",
    preheader: "See which personal-loan options may be available.",
    eyebrow: "WHEN TIMING MATTERS",
    headline: "Options while payday is still days away",
    body: "Hi {{name}}, if an expense cannot wait, you can review available personal-loan options. Approval and terms are determined by the provider.",
    ctaLabel: "Check available options",
    accentColor: "#2f7a62",
  },
  {
    id: "email_template_checklist",
    name: "Comparison checklist",
    status: "ACTIVE" as const,
    subject: "Three things to compare before choosing",
    preheader: "A quick checklist for reviewing loan terms.",
    eyebrow: "SMART COMPARISON",
    headline: "Compare more than the monthly payment",
    body: "Review the APR, total repayment amount, and payment schedule for every option. Your link is ready when you want to continue.",
    ctaLabel: "Compare loan options",
    accentColor: "#315f78",
  },
];

export async function ensureEmailTemplates() {
  for (const preset of presets)
    await db.emailTemplate.upsert({
      where: { id: preset.id },
      create: preset,
      update: {},
    });
}

export async function listEmailTemplates() {
  await ensureEmailTemplates();
  return db.emailTemplate.findMany({ orderBy: { updatedAt: "desc" } });
}

export async function saveEmailTemplate(input: unknown, actor: string) {
  const data = emailTemplateSchema.parse(input);
  const normalized = {
    ...data,
    htmlSource:
      data.htmlSource !== null
        ? normalizeEmailHtmlSource(data.htmlSource)
        : null,
  };
  const { id, ...fields } = normalized;
  const template = await db.emailTemplate.upsert({
    where: { id: id ?? "new" },
    create: fields,
    update: fields,
  });
  await audit(actor, "email_template.saved", template.id);
  return template;
}

const emailTags = [
  "a",
  "b",
  "blockquote",
  "br",
  "center",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "small",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
];
const safeStyle = [
  /^(?!.*(?:expression\s*\(|javascript:|url\s*\(|@import|[<>])).{0,500}$/i,
];
const emailStyles = Object.fromEntries(
  [
    "background",
    "background-color",
    "border",
    "border-bottom",
    "border-color",
    "border-left",
    "border-radius",
    "border-right",
    "border-style",
    "border-top",
    "border-width",
    "color",
    "display",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "height",
    "letter-spacing",
    "line-height",
    "margin",
    "margin-bottom",
    "margin-left",
    "margin-right",
    "margin-top",
    "max-width",
    "min-width",
    "padding",
    "padding-bottom",
    "padding-left",
    "padding-right",
    "padding-top",
    "text-align",
    "text-decoration",
    "text-transform",
    "vertical-align",
    "white-space",
    "width",
  ].map((property) => [property, safeStyle]),
);
const linkMarker = "https://sparecash.invalid/followup-link";
const unsubscribeMarker = "https://sparecash.invalid/unsubscribe";

function isHostedMarketingImage(value: string) {
  try {
    const url = new URL(value);
    return (
      url.origin === new URL(env.APP_URL).origin &&
      /^\/media\/landing\/[A-Za-z0-9_-]+\.webp$/.test(url.pathname) &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function normalizeEmailHtmlSource(value: string) {
  const source = value.trim();
  if (!source) throw new Error("Custom email HTML cannot be empty");
  if (!/href\s*=\s*["']\{\{link\}\}["']/i.test(source))
    throw new Error(
      'Custom email HTML must include a link with href="{{link}}" so clicks remain attributable',
    );
  const imageSources = [
    ...source.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi),
  ].map((match) => match[1]);
  if ((source.match(/<img\b/gi) ?? []).length !== imageSources.length)
    throw new Error("Every email image needs a quoted src URL");
  if (imageSources.some((src) => !isHostedMarketingImage(src)))
    throw new Error(
      "Email images must use an absolute URL returned by list_landing_assets",
    );
  const marked = source
    .replaceAll("{{link}}", linkMarker)
    .replaceAll("{{unsubscribe}}", unsubscribeMarker);
  const sanitized = sanitizeHtml(marked, {
    allowedTags: emailTags,
    allowedAttributes: {
      "*": ["class", "style", "title"],
      a: ["href", "name", "rel", "target", "style", "title"],
      img: ["alt", "height", "src", "style", "title", "width"],
      table: [
        "align",
        "bgcolor",
        "border",
        "cellpadding",
        "cellspacing",
        "role",
        "style",
        "width",
      ],
      tbody: ["align", "bgcolor", "style", "valign"],
      td: [
        "align",
        "bgcolor",
        "colspan",
        "height",
        "rowspan",
        "style",
        "valign",
        "width",
      ],
      th: [
        "align",
        "bgcolor",
        "colspan",
        "rowspan",
        "style",
        "valign",
        "width",
      ],
      tr: ["align", "bgcolor", "style", "valign"],
    },
    allowedSchemes: ["https", "mailto"],
    allowProtocolRelative: false,
    allowedStyles: { "*": emailStyles },
    exclusiveFilter(frame) {
      if (frame.tag === "img")
        return !isHostedMarketingImage(frame.attribs.src ?? "");
      return false;
    },
  })
    .replaceAll(linkMarker, "{{link}}")
    .replaceAll(unsubscribeMarker, "{{unsubscribe}}")
    .trim();
  const sanitizedImageCount = (sanitized.match(/<img\b/gi) ?? []).length;
  if (sanitizedImageCount !== imageSources.length)
    throw new Error("One or more email images could not be safely included");
  return sanitized;
}

const paragraphs = (value: string) =>
  value
    .split(/\n{2,}/)
    .map(
      (part) =>
        `<p style="margin:0 0 16px">${escapeHtml(part).replaceAll("\n", "<br>")}</p>`,
    )
    .join("");

export function renderEmailTemplate(input: {
  template: EmailTemplate;
  name: string;
  link: string;
  unsubscribe: string;
  businessName: string;
  businessAddress: string;
}) {
  const template = input.template;
  const subject = renderMessage(template.subject, input.name, input.link);
  const body = renderMessage(template.body, input.name, input.link);
  const preheader = renderMessage(template.preheader, input.name, input.link);
  const headline = renderMessage(template.headline, input.name, input.link);
  const accent = template.accentColor;
  const footer = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:0 auto;background:#f8faf6"><tr><td style="padding:22px 38px;font-size:12px;line-height:1.5;color:#74847d">SpareCash is not a lender. A participating provider reviews your application and available terms.<br><br>${escapeHtml(input.businessName)} · ${escapeHtml(input.businessAddress)}<br><a href="${escapeHtml(input.unsubscribe)}" style="color:${accent}">Manage preferences or unsubscribe</a></td></tr></table>`;
  const custom =
    template.htmlSource !== null
      ? normalizeEmailHtmlSource(template.htmlSource)
          .replaceAll("{{name}}", escapeHtml(input.name.trim() || "there"))
          .replaceAll("{{link}}", escapeHtml(input.link))
          .replaceAll("{{unsubscribe}}", escapeHtml(input.unsubscribe))
          .replaceAll("{{business_name}}", escapeHtml(input.businessName))
          .replaceAll("{{business_address}}", escapeHtml(input.businessAddress))
      : null;
  const content =
    custom ??
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f5ef;padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fff;border:1px solid #dce5d9;border-radius:24px;overflow:hidden"><tr><td style="height:10px;background:${accent}"></td></tr><tr><td style="padding:38px 38px 20px"><div style="font-size:12px;letter-spacing:2px;font-weight:700;color:${accent};margin-bottom:14px">${escapeHtml(template.eyebrow)}</div><h1 style="font-size:34px;line-height:1.1;margin:0 0 18px;color:#173b31">${escapeHtml(headline)}</h1><div style="font-size:17px;line-height:1.6;color:#486158">${paragraphs(body)}</div><p style="margin:28px 0"><a href="${escapeHtml(input.link)}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;font-weight:700;padding:15px 24px;border-radius:999px">${escapeHtml(template.ctaLabel)}</a></p></td></tr></table></td></tr></table>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f2f5ef;font-family:Arial,sans-serif;color:#203d34"><div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</div>${content}${footer}</body></html>`;
  return { subject, body, html };
}

export function previewEmailTemplate(input: unknown) {
  const data = emailTemplateSchema.parse(input);
  const template = {
    ...data,
    id: data.id ?? "preview",
    htmlSource:
      data.htmlSource !== null
        ? normalizeEmailHtmlSource(data.htmlSource)
        : null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } satisfies EmailTemplate;
  return renderEmailTemplate({
    template,
    name: "Alex",
    link: `${env.APP_URL}/followup/preview-link`,
    unsubscribe: `${env.APP_URL}/preferences?token=preview`,
    businessName: "SpareCash",
    businessAddress: "Chicago, IL",
  });
}
