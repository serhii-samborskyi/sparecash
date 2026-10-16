import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import postcss from "postcss";
import prefixSelector from "postcss-prefix-selector";
import { parseFragment } from "parse5";
import sanitizeHtml from "sanitize-html";
import { db } from "../db.js";
import { landingImages } from "../landing-images.js";
import {
  customLandingSourceSchema,
  listLandingSourcesSchema,
} from "../custom-landing-schema.js";
import type { z } from "zod";
import { landingSchema } from "../domain.js";

const SLOT = "<sparecash-funnel></sparecash-funnel>";
const SCOPE = ".custom-landing-content";
const allowedTags = [
  "main",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "nav",
  "div",
  "span",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "figure",
  "figcaption",
  "picture",
  "img",
  "a",
  "button",
  "strong",
  "b",
  "em",
  "i",
  "small",
  "mark",
  "blockquote",
  "cite",
  "time",
  "br",
  "hr",
  "details",
  "summary",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "caption",
  "iframe",
  "form",
  "input",
  "label",
  "output",
  "sparecash-funnel",
];
const blockedMarkup =
  /<(?:script|style|select|textarea|meta|link|base|object|embed|svg|math|template)\b|\son[a-z]+\s*=|\sstyle\s*=/i;
const v1FormMarkup = /<(?:form|input|label|output)\b/i;
const protectedNames =
  /(?:id|class)\s*=\s*["'][^"']*\b(?:application|optional-updates|application-card|public-header|public-footer|custom-landing-funnel)\b/i;
const assetPath =
  /^\/(?:media\/landing\/[a-z0-9]{20,40}\.webp|landing-assets\/[a-z0-9-]+\.(?:jpg|jpeg|png|webp))$/;
const videoFrame = (value: string) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      ((url.hostname === "www.youtube-nocookie.com" &&
        url.pathname.startsWith("/embed/")) ||
        (url.hostname === "player.vimeo.com" &&
          url.pathname.startsWith("/video/")))
    );
  } catch {
    return false;
  }
};

function directSlotCount(html: string) {
  const fragment = parseFragment(html) as unknown as {
    childNodes: { nodeName: string }[];
  };
  return fragment.childNodes.filter(
    (node) => node.nodeName === "sparecash-funnel",
  ).length;
}

function isBoundForm(html: string) {
  return /\bdata-sc-form\s*=\s*["']lead["']/i.test(html);
}

function cleanFragment(html: string, version: 1 | 2) {
  return sanitizeHtml(html, {
    allowedTags,
    allowedAttributes: {
      "*": [
        "id",
        "class",
        "title",
        "role",
        "aria-*",
        "data-sc-action",
        "data-sc-form",
        "data-sc-field",
        "data-sc-contact",
        "data-sc-output",
        "data-sc-format",
        "data-sc-errors",
        "data-sc-consent",
        "data-sc-activity",
        "data-sc-bind",
      ],
      a: ["href", "target", "rel"],
      button: ["type", "data-sc-action", "aria-*", "class", "id"],
      form: ["class", "id", "data-sc-form", "aria-*"],
      input: [
        "type",
        "class",
        "id",
        "placeholder",
        "autocomplete",
        "inputmode",
        "min",
        "max",
        "step",
        "value",
        "maxlength",
        "required",
        "data-sc-field",
        "data-sc-contact",
        "aria-*",
      ],
      label: ["for", "class", "id"],
      output: [
        "for",
        "class",
        "id",
        "data-sc-output",
        "data-sc-format",
        "aria-*",
      ],
      img: [
        "src",
        "alt",
        "width",
        "height",
        "loading",
        "decoding",
        "class",
        "id",
      ],
      iframe: [
        "src",
        "title",
        "width",
        "height",
        "allow",
        "allowfullscreen",
        "loading",
        "referrerpolicy",
        "sandbox",
        "class",
        "id",
      ],
      time: ["datetime", "class", "id"],
      th: ["scope", "colspan", "rowspan", "class", "id"],
      td: ["colspan", "rowspan", "class", "id"],
    },
    allowedSchemes: ["https", "mailto", "tel"],
    allowProtocolRelative: false,
    allowedIframeHostnames: ["www.youtube-nocookie.com", "player.vimeo.com"],
    transformTags: {
      a: (_tag, attributes) => ({
        tagName: "a",
        attribs: {
          ...attributes,
          ...(attributes.target === "_blank"
            ? { rel: "noopener noreferrer" }
            : {}),
        },
      }),
      button: (_tag, attributes) => ({
        tagName: "button",
        attribs: {
          ...attributes,
          type:
            version === 2 && attributes["data-sc-action"] === "submit"
              ? "submit"
              : "button",
          ...(["open-funnel", "submit"].includes(
            attributes["data-sc-action"] ?? "",
          )
            ? {}
            : { "data-sc-action": "" }),
        },
      }),
      form: (_tag, attributes) => ({
        tagName: "form",
        attribs: {
          class: attributes.class ?? "",
          id: attributes.id ?? "",
          "data-sc-form": attributes["data-sc-form"] ?? "",
        },
      }),
      input: (_tag, attributes) => {
        const type = ["range", "text", "tel", "email"].includes(
          attributes.type ?? "",
        )
          ? attributes.type
          : "text";
        return {
          tagName: "input",
          attribs: { ...attributes, type },
        };
      },
      iframe: (_tag, attributes) => ({
        tagName: "iframe",
        attribs: {
          ...attributes,
          loading: "lazy",
          referrerpolicy: "no-referrer",
          sandbox: "allow-scripts allow-same-origin allow-presentation",
          allow:
            "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture",
        },
      }),
    },
    exclusiveFilter(frame) {
      if (frame.tag === "img") return !assetPath.test(frame.attribs.src ?? "");
      if (frame.tag === "iframe") return !videoFrame(frame.attribs.src ?? "");
      if (frame.tag === "button")
        return !["open-funnel", "submit"].includes(
          frame.attribs["data-sc-action"] ?? "",
        );
      return false;
    },
  }).trim();
}

async function scopeCss(css: string, version: 1 | 2) {
  if (!css.trim()) return "";
  const root = postcss.parse(css, { from: undefined });
  root.walkAtRules((rule) => {
    if (
      !["media", "supports", "keyframes", "-webkit-keyframes"].includes(
        rule.name,
      )
    )
      throw rule.error(`@${rule.name} is not supported`);
  });
  root.walkRules((rule) => {
    if (
      /\b(?:html|body)\b|:root|sparecash-funnel|application-card/i.test(
        rule.selector,
      )
    )
      throw rule.error("Selectors may only target authored page content");
  });
  root.walkDecls((declaration) => {
    const value = declaration.value;
    const activityRule =
      version === 2 &&
      declaration.parent?.type === "rule" &&
      /\[data-sc-activity\]/.test(declaration.parent.selector);
    if (
      /url\s*\(|expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(
        value,
      )
    )
      throw declaration.error(
        "External or executable CSS values are not supported",
      );
    if (
      declaration.prop === "position" &&
      /^(?:fixed|sticky|absolute)$/i.test(value.trim()) &&
      !activityRule
    )
      throw declaration.error("Positioned overlays are not supported");
    if (declaration.prop === "z-index" && Number(value) > 10)
      throw declaration.error("z-index must be 10 or less");
    if (
      /^(?:transform|translate|scale|rotate|inset|top|right|bottom|left|clip-path)$/i.test(
        declaration.prop,
      ) &&
      !activityRule
    )
      throw declaration.error(
        "CSS that can move content over protected controls is not supported",
      );
    if (
      /^margin(?:-|$)/i.test(declaration.prop) &&
      /(?:^|[ (,:])-\d/.test(value)
    )
      throw declaration.error("Negative margins are not supported");
  });
  return (
    await postcss([
      prefixSelector({
        prefix: SCOPE,
        transform(prefix, selector, prefixedSelector) {
          return selector.trim() === prefix ? prefix : prefixedSelector;
        },
      }),
    ]).process(root, { from: undefined })
  ).css;
}

export async function prepareCustomLandingSource(input: unknown) {
  const data = customLandingSourceSchema.parse(input);
  const version: 1 | 2 = isBoundForm(data.html) ? 2 : 1;
  if (blockedMarkup.test(data.html))
    throw new Error(
      "Custom HTML cannot contain scripts, styles, unsupported controls, metadata, inline styles or event handlers.",
    );
  if (version === 1 && v1FormMarkup.test(data.html))
    throw new Error(
      'Legacy custom HTML cannot contain forms or form controls. Use data-sc-form="lead" for a bound custom form.',
    );
  if (protectedNames.test(data.html))
    throw new Error(
      "Custom HTML cannot reuse protected SpareCash ids or classes",
    );
  const occurrences = data.html.split(SLOT).length - 1;
  if (
    (version === 1 &&
      (occurrences !== 1 || directSlotCount(data.html) !== 1)) ||
    (version === 2 && occurrences !== 0)
  )
    throw new Error(
      version === 1
        ? `HTML must contain exactly one top-level ${SLOT} slot between authored sections`
        : "Bound custom forms replace the funnel slot and cannot include sparecash-funnel",
    );
  const [before, after = ""] =
    version === 1 ? data.html.split(SLOT) : [data.html, ""];
  const htmlBefore = cleanFragment(before, version);
  const htmlAfter = cleanFragment(after, version);
  if (protectedNames.test(htmlBefore + htmlAfter))
    throw new Error(
      "Custom HTML cannot reuse protected SpareCash ids or classes",
    );
  if (((htmlBefore + htmlAfter).match(/<h1\b/gi) ?? []).length !== 1)
    throw new Error("Custom HTML must contain exactly one h1 heading");
  if (version === 2) {
    if ((htmlBefore.match(/<form\b/gi) ?? []).length !== 1)
      throw new Error("Bound custom HTML must contain exactly one form");
    if (!/<form\b[^>]*data-sc-form="lead"/i.test(htmlBefore))
      throw new Error('The bound form must use data-sc-form="lead"');
    if ((htmlBefore.match(/data-sc-action="submit"/gi) ?? []).length !== 1)
      throw new Error(
        'The bound form needs exactly one button with data-sc-action="submit"',
      );
    if (!/data-sc-(?:field|contact)="[a-z][a-z0-9_]*"/i.test(htmlBefore))
      throw new Error("The bound form must contain at least one data binding");
    if (!/data-sc-errors(?:="")?/i.test(htmlBefore))
      throw new Error("The bound form needs a data-sc-errors message element");
    if (
      /data-sc-contact="(?:phone|email)"/i.test(htmlBefore) &&
      !/data-sc-consent(?:="")?/i.test(htmlBefore)
    )
      throw new Error(
        "Forms that collect phone or email need a data-sc-consent element",
      );
  }
  const css = await scopeCss(data.css, version);
  if (!(htmlBefore + htmlAfter).trim())
    throw new Error("Custom HTML must contain visible authored content");
  return {
    name: data.name,
    htmlBefore,
    htmlAfter,
    css,
    version,
    changed:
      htmlBefore !== before.trim() ||
      htmlAfter !== after.trim() ||
      css !== data.css.trim(),
  };
}

function sourceView(source: {
  id: string;
  name: string;
  htmlBefore: string;
  htmlAfter: string;
  css: string;
  sha256: string;
  createdAt: Date;
}) {
  return {
    id: source.id,
    name: source.name,
    sha256: source.sha256,
    htmlBytes:
      Buffer.byteLength(source.htmlBefore) +
      Buffer.byteLength(source.htmlAfter),
    cssBytes: Buffer.byteLength(source.css),
    createdAt: source.createdAt,
    version: isBoundForm(source.htmlBefore) ? 2 : 1,
  };
}

export async function validateCustomLandingSource(input: unknown) {
  try {
    const source = await prepareCustomLandingSource(input);
    await assertCustomLandingAssetMarkup(
      `${source.htmlBefore}${source.htmlAfter}`,
    );
    return {
      valid: true,
      sanitized: source.changed,
      htmlBytes:
        Buffer.byteLength(source.htmlBefore) +
        Buffer.byteLength(source.htmlAfter),
      cssBytes: Buffer.byteLength(source.css),
      issues: [],
      next: "Create the immutable source, reference its id from config.customLanding.sourceId, save a DRAFT experiment, then inspect each preview URL on desktop and mobile.",
    };
  } catch (error) {
    return {
      valid: false,
      issues: [{ path: "source", message: (error as Error).message }],
    };
  }
}

export async function createCustomLandingSource(input: unknown, actor: string) {
  const prepared = await prepareCustomLandingSource(input);
  await assertCustomLandingAssetMarkup(
    `${prepared.htmlBefore}${prepared.htmlAfter}`,
  );
  const sha256 = createHash("sha256")
    .update(prepared.htmlBefore)
    .update("\0")
    .update(prepared.htmlAfter)
    .update("\0")
    .update(prepared.css)
    .digest("hex");
  const source = await db.$transaction(async (tx) => {
    const { changed: _changed, version: _version, ...content } = prepared;
    const stored = await tx.landingSource.upsert({
      where: { sha256 },
      update: {},
      create: { ...content, sha256 },
    });
    await tx.auditLog.create({
      data: {
        actor,
        action: "landing_source.created",
        entityId: stored.id,
        details: { name: stored.name, sha256, sanitized: prepared.changed },
      },
    });
    return stored;
  });
  return {
    ...sourceView(source),
    sanitized: prepared.changed,
    reference: { sourceId: source.id },
  };
}

export async function listCustomLandingSources(input: unknown) {
  const { page, q } = listLandingSourcesSchema.parse(input);
  const where = q
    ? { name: { contains: q, mode: "insensitive" as const } }
    : {};
  const [items, total] = await db.$transaction([
    db.landingSource.findMany({
      where,
      take: 50,
      skip: (page - 1) * 50,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    db.landingSource.count({ where }),
  ]);
  return { items: items.map(sourceView), total, page, pageSize: 50 };
}

export async function getCustomLandingSource(id: string) {
  const source = await db.landingSource.findUniqueOrThrow({ where: { id } });
  return {
    ...sourceView(source),
    html: isBoundForm(source.htmlBefore)
      ? source.htmlBefore
      : `${source.htmlBefore}\n${SLOT}\n${source.htmlAfter}`,
    css: source.css,
    reference: { sourceId: source.id },
  };
}

async function assertCustomLandingAssetMarkup(
  html: string,
  client: Pick<typeof db, "landingAsset"> = db,
) {
  const sources = [...html.matchAll(/\s(?:src|srcset)="([^"]+)"/g)].map(
    (match) => match[1].split(/\s+/)[0],
  );
  const uploaded = [
    ...new Set(
      sources.flatMap((src) => {
        const match = src.match(/^\/media\/landing\/([a-z0-9]{20,40})\.webp$/);
        return match ? [match[1]] : [];
      }),
    ),
  ];
  const unknownBundled = sources.some(
    (src) =>
      src.startsWith("/landing-assets/") &&
      !landingImages.some((image) => image.src === src),
  );
  if (
    unknownBundled ||
    (uploaded.length &&
      (await client.landingAsset.count({ where: { id: { in: uploaded } } })) !==
        uploaded.length)
  )
    throw new Error(
      "An image is missing from the media library. Upload it before creating the custom source.",
    );
}

export async function assertCustomLandingSources(
  configs: {
    customLanding?: { sourceId: string };
    customForm?: z.infer<typeof landingSchema>["customForm"];
  }[],
  client: Pick<typeof db, "landingSource"> = db,
) {
  const ids = [
    ...new Set(
      configs.flatMap((config) =>
        config.customLanding ? [config.customLanding.sourceId] : [],
      ),
    ),
  ];
  const sources = ids.length
    ? await client.landingSource.findMany({
        where: { id: { in: ids } },
        select: { id: true, htmlBefore: true },
      })
    : [];
  if (sources.length !== ids.length)
    throw new Error(
      "A custom landing source is missing. Create it before saving the experiment.",
    );
  const byId = new Map(sources.map((source) => [source.id, source]));
  for (const config of configs) {
    if (!config.customLanding) continue;
    const source = byId.get(config.customLanding.sourceId)!;
    const version = isBoundForm(source.htmlBefore) ? 2 : 1;
    if (Boolean(config.customForm) !== (version === 2))
      throw new Error(
        version === 2
          ? "A bound custom landing source requires config.customForm."
          : "config.customForm requires a v2 bound custom landing source.",
      );
    if (!config.customForm) continue;
    const fieldBindings = [
      ...source.htmlBefore.matchAll(/data-sc-field="([a-z][a-z0-9_]*)"/gi),
    ].map((match) => match[1]);
    const contactBindings = [
      ...source.htmlBefore.matchAll(/data-sc-contact="(name|phone|email)"/gi),
    ].map((match) => match[1]);
    const expectedFields = config.customForm.fields.map((field) => field.id);
    if (
      new Set(fieldBindings).size !== fieldBindings.length ||
      fieldBindings.length !== expectedFields.length ||
      expectedFields.some((id) => !fieldBindings.includes(id))
    )
      throw new Error(
        "Custom form field bindings must match config.customForm.fields exactly.",
      );
    const expectedContacts = Object.entries(config.customForm.contacts)
      .filter(([, requirement]) => requirement !== "hidden")
      .map(([name]) => name);
    if (
      new Set(contactBindings).size !== contactBindings.length ||
      contactBindings.length !== expectedContacts.length ||
      expectedContacts.some((name) => !contactBindings.includes(name))
    )
      throw new Error(
        "Custom contact bindings must match the non-hidden customForm contacts exactly.",
      );
  }
}

export type CustomLandingRuntime = {
  sourceId: string;
  name: string;
  htmlBefore: string;
  htmlAfter: string;
  css: string;
  version: 1 | 2;
};

const cityPattern = /^[\p{L}\p{M} .'-]{2,80}$/u;

function landingLocation(
  value: unknown,
  fallback: unknown,
  defaultValue: string,
) {
  for (const candidate of [value, fallback, defaultValue]) {
    if (typeof candidate !== "string") continue;
    const clean = candidate.trim();
    if (cityPattern.test(clean)) return clean;
  }
  return defaultValue;
}

function replaceLocationTokens(
  value: unknown,
  city: string,
  region: string,
): unknown {
  const regionPhrase = region ? ` in ${region}` : "";
  if (typeof value === "string")
    return value
      .replaceAll("{{city}}", city)
      .replaceAll("{{region}}", region)
      .replaceAll("{{region_phrase}}", regionPhrase);
  if (Array.isArray(value))
    return value.map((item) => replaceLocationTokens(item, city, region));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceLocationTokens(item, city, region),
      ]),
    );
  return value;
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character]!,
  );
}

export async function hydrateCustomLandingConfig<
  T extends {
    customLanding?: { sourceId: string };
    cityFallback?: string;
    regionFallback?: string;
  },
>(
  config: T,
  personalization: { city?: string | null; region?: string | null } = {},
): Promise<
  Omit<T, "customLanding"> & { customLanding?: CustomLandingRuntime }
> {
  const { customLanding, ...base } = config;
  const city = landingLocation(
    personalization.city,
    config.cityFallback,
    "your area",
  );
  const region = landingLocation(
    personalization.region,
    config.regionFallback,
    "",
  );
  const personalized = replaceLocationTokens(base, city, region) as Omit<
    T,
    "customLanding"
  >;
  if (!customLanding) return personalized;
  const source = await db.landingSource.findUniqueOrThrow({
    where: { id: customLanding.sourceId },
  });
  return {
    ...personalized,
    customLanding: {
      sourceId: source.id,
      name: source.name,
      htmlBefore: source.htmlBefore
        .replaceAll("{{city}}", escapeHtml(city))
        .replaceAll("{{region}}", escapeHtml(region))
        .replaceAll(
          "{{region_phrase}}",
          region ? ` in ${escapeHtml(region)}` : "",
        ),
      htmlAfter: source.htmlAfter
        .replaceAll("{{city}}", escapeHtml(city))
        .replaceAll("{{region}}", escapeHtml(region))
        .replaceAll(
          "{{region_phrase}}",
          region ? ` in ${escapeHtml(region)}` : "",
        ),
      css: source.css,
      version: isBoundForm(source.htmlBefore) ? 2 : 1,
    },
  };
}
