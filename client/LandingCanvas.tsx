import { createElement, type CSSProperties, type ReactNode } from "react";
import type {
  LandingDesign,
  DesignNode,
  DesignStyle,
} from "../server/landing-design";
import "./landing-canvas.css";

const fonts = {
  modern: '"Manrope", system-ui, sans-serif',
  humanist: '"Trebuchet MS", Verdana, sans-serif',
  editorial: 'Georgia, "Times New Roman", serif',
  classic: 'Palatino, "Palatino Linotype", Georgia, serif',
  mono: 'ui-monospace, "SFMono-Regular", Consolas, monospace',
};
const shadows = {
  none: "none",
  soft: "0 16px 40px #0000000d",
  bold: "0 8px 0 #00000026",
};
function nodeVariables(
  node: Exclude<DesignNode, { type: "funnel" }>,
  design: LandingDesign,
) {
  const heading = node.type === "heading";
  const base: DesignStyle = {
    fontSize: heading ? (node.level === 1 ? 64 : 32) : 18,
    font: heading ? design.headingFont : design.font,
    fontWeight: heading || node.type === "action" ? "700" : "400",
    lineHeight: heading ? 1.1 : 1.6,
    columns: 1,
    gap: 24,
    padding: 0,
    radius: 0,
    borderWidth: 0,
    ...node.style,
  };
  const mobile: DesignStyle = {
    ...base,
    // Stack by default, even when desktop explicitly requests multiple columns.
    columns: 1,
    fontSize: Math.min(base.fontSize!, heading ? 40 : 20),
    padding: Math.min(base.padding!, 24),
    gap: Math.min(base.gap!, 24),
    ...node.mobile,
  };
  const props: Record<string, string | number> = {};
  function add(style: DesignStyle, prefix: string) {
    const values = {
      background: style.background ?? "transparent",
      color: style.color ?? "inherit",
      "border-color": style.borderColor ?? "currentColor",
      "border-width": `${style.borderWidth}px`,
      radius: `${style.radius}px`,
      // cap horizontal padding as columns get narrow; no clipping or overlap
      padding: `min(${style.padding}px, 6%)`,
      gap: `${style.gap}px`,
      width: style.maxWidth ? `${style.maxWidth}px` : "100%",
      columns: style.columns!,
      align: style.align ?? "start",
      "text-align": style.textAlign ?? "inherit",
      font: fonts[style.font!],
      size: `${style.fontSize}px`,
      weight: style.fontWeight!,
      leading: style.lineHeight!,
      tracking: `${style.letterSpacing ?? 0}px`,
      shadow: shadows[style.shadow ?? "none"],
    };
    for (const [key, value] of Object.entries(values))
      props[`--dc-${prefix}${key}`] = value;
  }
  add(base, "d-");
  add(mobile, "m-");
  return props as CSSProperties;
}

export function LandingCanvas({
  design,
  funnel,
}: {
  design: LandingDesign;
  funnel: ReactNode;
}) {
  const nodes = new Map(design.nodes.map((node) => [node.id, node]));
  let imageIndex = 0;
  const render = (id: string): ReactNode => {
    const node = nodes.get(id)!;
    if (node.type === "funnel")
      return (
        <div key={id} className="design-funnel">
          {funnel}
        </div>
      );
    const attrs = {
      "data-design-node": id,
      className: `design-node design-${node.type}`,
      style: nodeVariables(node, design),
    };
    switch (node.type) {
      case "container":
        return (
          <div key={id} {...attrs}>
            {node.children.map(render)}
          </div>
        );
      case "heading":
        return createElement(
          `h${node.level}`,
          { ...attrs, key: id },
          node.text,
        );
      case "text":
        return (
          <p key={id} {...attrs}>
            {node.text}
          </p>
        );
      case "image": {
        const primaryImage = imageIndex++ === 0;
        return (
          <figure key={id} {...attrs}>
            <img
              src={node.image.src}
              alt={node.image.alt}
              loading={primaryImage ? "eager" : "lazy"}
              fetchPriority={primaryImage ? "high" : undefined}
              decoding="async"
              style={{
                aspectRatio: {
                  auto: "auto",
                  square: "1",
                  landscape: "3 / 2",
                  wide: "16 / 9",
                  portrait: "4 / 5",
                }[node.aspect],
                objectFit: node.fit,
              }}
            />
          </figure>
        );
      }
      case "list":
        return createElement(
          node.ordered ? "ol" : "ul",
          { ...attrs, key: id },
          node.items.map((item, index) => <li key={index}>{item}</li>),
        );
      case "action":
        return (
          <a
            key={id}
            {...attrs}
            href="#application"
            onClick={() =>
              document
                .getElementById("application")
                ?.focus({ preventScroll: true })
            }
          >
            {node.text}
            <span aria-hidden="true"> ↗</span>
          </a>
        );
      case "faq":
        return (
          <details key={id} {...attrs}>
            <summary>{node.question}</summary>
            <p>{node.answer}</p>
          </details>
        );
      case "divider":
        return <hr key={id} {...attrs} />;
    }
  };
  return (
    <main
      className="landing-canvas"
      style={{
        background: design.background,
        color: design.color,
        fontFamily: fonts[design.font],
      }}
    >
      {render(design.root)}
    </main>
  );
}
