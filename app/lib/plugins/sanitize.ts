import type { PluginPatch } from "@typbase/typing";

/**
 * Sanitizes plugin HTML before it reaches the sandboxed frame and lifts the
 * hidden patch element out of it. Typst emits semantic HTML plus the
 * `data-tb-*` attributes the runtime understands; anything else is dropped.
 *
 * The frame is an opaque origin with a locked-down CSP, so this is defense in
 * depth rather than the only wall. Keep the allowlist tight anyway.
 */

const DROP_TAGS = new Set([
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "portal",
]);

const ALLOWED_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "blockquote",
  "br",
  "button",
  "canvas",
  "circle",
  "code",
  "col",
  "colgroup",
  "dd",
  "defs",
  "del",
  "details",
  "div",
  "dl",
  "dt",
  "ellipse",
  "em",
  "figcaption",
  "figure",
  "footer",
  "g",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "li",
  "line",
  "main",
  "mark",
  "math",
  "menu",
  "meter",
  "nav",
  "ol",
  "option",
  "output",
  "p",
  "path",
  "polygon",
  "polyline",
  "pre",
  "progress",
  "q",
  "rect",
  "s",
  "samp",
  "section",
  "select",
  "small",
  "span",
  "strong",
  "style",
  "sub",
  "summary",
  "sup",
  "svg",
  "table",
  "tbody",
  "td",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "u",
  "ul",
  "use",
  "var",
]);

/** Attributes safe to keep on any element. */
const GLOBAL_ATTRS = new Set([
  "class",
  "id",
  "style",
  "title",
  "lang",
  "dir",
  "role",
  "tabindex",
  "hidden",
  "value",
]);

/** Extra attributes per tag/kind of attribute. Everything `data-*` passes. */
const ATTRS = new Set([
  "alt",
  "width",
  "height",
  "src",
  "href",
  "fill",
  "fill-rule",
  "clip-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "transform",
  "viewBox",
  "d",
  "points",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "offset",
  "stop-color",
  "colspan",
  "rowspan",
  "type",
  "name",
  "placeholder",
  "checked",
  "disabled",
  "selected",
  "multiple",
  "min",
  "max",
  "step",
  "rows",
  "cols",
  "for",
  "colspan",
  "aria-label",
  "aria-hidden",
  "aria-selected",
  "aria-disabled",
  "aria-expanded",
  "contenteditable",
]);

const SAFE_URL = /^(https?:|mailto:|tel:|data:image\/|blob:|#|typbase:)/i;
const UNSAFE_STYLE = /url\s*\(|expression\s*\(|@import|behavior\s*:|-moz-binding/i;

function cleanStyle(value: string): string {
  return UNSAFE_STYLE.test(value) ? "" : value;
}

function cleanUrl(value: string): string | null {
  return SAFE_URL.test(value.trim()) ? value : null;
}

function sanitizeElement(element: Element): void {
  for (const child of [...element.children]) sanitizeElement(child);

  for (const attr of [...element.attributes]) {
    const name = attr.name.toLowerCase();
    const value = attr.value;

    if (name.startsWith("on")) {
      element.removeAttribute(attr.name);
      continue;
    }

    if (name.startsWith("data-") || name.startsWith("aria-")) continue;

    if (!GLOBAL_ATTRS.has(name) && !ATTRS.has(name)) {
      element.removeAttribute(attr.name);
      continue;
    }

    if (name === "style") {
      element.setAttribute(attr.name, cleanStyle(value));
      continue;
    }

    if (name === "href" || name === "src") {
      const cleaned = cleanUrl(value);
      if (cleaned === null) element.removeAttribute(attr.name);
      continue;
    }
  }
}

export interface SanitizedSurface {
  html: string;
  patch: PluginPatch | null;
  /** Problems worth surfacing in the plugin lab. */
  errors: string[];
}

/** Parses the patch, strips its holder, and rewrites the DOM safely. */
export function sanitizePluginHtml(raw: string): SanitizedSurface {
  const errors: string[] = [];
  const doc = new DOMParser().parseFromString(raw, "text/html");

  let patch: PluginPatch | null = null;
  const holders = doc.querySelectorAll("[data-tb-patch]");
  if (holders.length > 1) errors.push("more than one patch holder; only the first is applied");

  for (const holder of holders) {
    if (patch === null) {
      try {
        const value = JSON.parse(holder.getAttribute("data-tb-patch") ?? "null") as unknown;
        if (value && typeof value === "object") patch = value as PluginPatch;
        else errors.push("patch holder did not contain an object");
      } catch (error) {
        errors.push(`patch JSON failed to parse: ${String(error)}`);
      }
    }

    holder.remove();
  }

  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      const tag = child.tagName.toLowerCase();
      if (DROP_TAGS.has(tag)) {
        child.remove();
        continue;
      }

      if (!ALLOWED_TAGS.has(tag)) {
        // Unknown but harmless: keep the children, drop the wrapper.
        child.replaceWith(...child.childNodes);
        continue;
      }

      sanitizeElement(child);
      walk(child);
    }
  };

  walk(doc.body);

  for (const style of doc.querySelectorAll("style")) {
    if (UNSAFE_STYLE.test(style.textContent ?? "")) style.remove();
  }

  // Typst's HTML export can put generated CSS in the head; keep it with the
  // fragment so classes keep working after the body is injected.
  const headStyles: string[] = [];
  for (const style of doc.head.querySelectorAll("style")) {
    if (!UNSAFE_STYLE.test(style.textContent ?? "")) headStyles.push(style.outerHTML);
  }

  return { html: headStyles.join("") + doc.body.innerHTML, patch, errors };
}
