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
  "sparecash-funnel",
];
const blockedMarkup =
  /<(?:script|style|form|input|select|textarea|label|meta|link|base|object|embed|svg|math|template)\b|\son[a-z]+\s*=|\sstyle\s*=/i;
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

function cleanFragment(html: string) {
  return sanitizeHtml(html, {
    allowedTags,
    allowedAttributes: {
      "*": ["id", "class", "title", "role", "aria-*", "data-sc-action"],
      a: ["href", "target", "rel"],
      button: ["type", "data-sc-action", "aria-*", "class", "id"],
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
          type: "button",
          ...(attributes["data-sc-action"] === "open-funnel"
            ? {}
            : { "data-sc-action": "" }),
        },
      }),
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
        return frame.attribs["data-sc-action"] !== "open-funnel";
      return false;
    },
  }).trim();
}

async function scopeCss(css: string) {
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
      /^(?:fixed|sticky|absolute)$/i.test(value.trim())
    )
      throw declaration.error("Positioned overlays are not supported");
    if (declaration.prop === "z-index" && Number(value) > 10)
      throw declaration.error("z-index must be 10 or less");
    if (
      /^(?:transform|translate|scale|rotate|inset|top|right|bottom|left|clip-path)$/i.test(
        declaration.prop,
      )
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
  if (blockedMarkup.test(data.html))
    throw new Error(
      "Custom HTML cannot contain scripts, styles, forms, form controls, inline styles or event handlers. Use the protected funnel slot for interaction.",
    );
  if (protectedNames.test(data.html))
    throw new Error(
      "Custom HTML cannot reuse protected SpareCash ids or classes",
    );
  const occurrences = data.html.split(SLOT).length - 1;
  if (occurrences !== 1 || directSlotCount(data.html) !== 1)
    throw new Error(
      `HTML must contain exactly one top-level ${SLOT} slot between authored sections`,
    );
  const [before, after] = data.html.split(SLOT);
  const htmlBefore = cleanFragment(before);
  const htmlAfter = cleanFragment(after);
  if (protectedNames.test(htmlBefore + htmlAfter))
    throw new Error(
      "Custom HTML cannot reuse protected SpareCash ids or classes",
    );
  if (((htmlBefore + htmlAfter).match(/<h1\b/gi) ?? []).length !== 1)
    throw new Error("Custom HTML must contain exactly one h1 heading");
  const css = await scopeCss(data.css);
  if (!(htmlBefore + htmlAfter).trim())
    throw new Error("Custom HTML must contain visible authored content");
  return {
    name: data.name,
    htmlBefore,
    htmlAfter,
    css,
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
    const { changed: _changed, ...content } = prepared;
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
    html: `${source.htmlBefore}\n${SLOT}\n${source.htmlAfter}`,
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
  configs: { customLanding?: { sourceId: string } }[],
  client: Pick<typeof db, "landingSource"> = db,
) {
  const ids = [
    ...new Set(
      configs.flatMap((config) =>
        config.customLanding ? [config.customLanding.sourceId] : [],
      ),
    ),
  ];
  if (
    ids.length &&
    (await client.landingSource.count({ where: { id: { in: ids } } })) !==
      ids.length
  )
    throw new Error(
      "A custom landing source is missing. Create it before saving the experiment.",
    );
}

export type CustomLandingRuntime = {
  sourceId: string;
  name: string;
  htmlBefore: string;
  htmlAfter: string;
  css: string;
};

export async function hydrateCustomLandingConfig<
  T extends {
    customLanding?: { sourceId: string };
  },
>(
  config: T,
): Promise<
  Omit<T, "customLanding"> & { customLanding?: CustomLandingRuntime }
> {
  const { customLanding, ...base } = config;
  if (!customLanding) return base;
  const source = await db.landingSource.findUniqueOrThrow({
    where: { id: customLanding.sourceId },
  });
  return {
    ...base,
    customLanding: {
      sourceId: source.id,
      name: source.name,
      htmlBefore: source.htmlBefore,
      htmlAfter: source.htmlAfter,
      css: source.css,
    },
  };
}
