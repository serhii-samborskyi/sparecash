import type { EmailTemplate } from "@prisma/client";
import { db } from "../db.js";
import { emailTemplateSchema, escapeHtml, renderMessage } from "../domain.js";
import { audit } from "./control.js";

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
  const { id, ...fields } = data;
  const template = await db.emailTemplate.upsert({
    where: { id: id ?? "new" },
    create: fields,
    update: fields,
  });
  await audit(actor, "email_template.saved", template.id);
  return template;
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
  const html = `<!doctype html><html><body style="margin:0;background:#f2f5ef;font-family:Arial,sans-serif;color:#203d34"><div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f5ef;padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fff;border:1px solid #dce5d9;border-radius:24px;overflow:hidden"><tr><td style="height:10px;background:${accent}"></td></tr><tr><td style="padding:38px 38px 20px"><div style="font-size:12px;letter-spacing:2px;font-weight:700;color:${accent};margin-bottom:14px">${escapeHtml(template.eyebrow)}</div><h1 style="font-size:34px;line-height:1.1;margin:0 0 18px;color:#173b31">${escapeHtml(headline)}</h1><div style="font-size:17px;line-height:1.6;color:#486158">${paragraphs(body)}</div><p style="margin:28px 0"><a href="${escapeHtml(input.link)}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;font-weight:700;padding:15px 24px;border-radius:999px">${escapeHtml(template.ctaLabel)}</a></p><p style="font-size:13px;line-height:1.5;color:#74847d">SpareCash is not a lender. A participating provider reviews your application and available terms.</p></td></tr><tr><td style="padding:22px 38px;background:#f8faf6;font-size:12px;line-height:1.5;color:#74847d">${escapeHtml(input.businessName)} · ${escapeHtml(input.businessAddress)}<br><a href="${escapeHtml(input.unsubscribe)}" style="color:${accent}">Manage preferences or unsubscribe</a></td></tr></table></td></tr></table></body></html>`;
  return { subject, body, html };
}
