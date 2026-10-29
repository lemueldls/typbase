/**
 * The social card markup shared by the committed typbase.at image and the
 * images generated for published sites. Takumi renders this HTML in Node for
 * the app card and in the browser for site cards.
 */
export interface SocialPalette {
  surface: string;
  surface2: string;
  border: string;
  text: string;
  textSecondary: string;
  accent: string;
}

export interface SocialCardInput {
  title: string;
  description: string;
  siteName: string;
  eyebrow?: string;
  host: string;
  footerRight?: string;
  /** Font family used for the card. Defaults to the bundled Maple Mono. */
  fontFamily?: string;
  palette: SocialPalette;
  /** A data URI for the app mark. The letter fallback is used when absent. */
  icon?: string;
  /** A workspace Material Symbol name, rendered by the icon font. */
  iconGlyph?: string;
}

export function socialCardHtml(input: SocialCardInput): string {
  const palette = input.palette;
  const fontFamily = cssFamily(input.fontFamily || "Maple Mono");
  const icon = input.iconGlyph
    ? `<span class="mark-glyph">${escapeHtml(input.iconGlyph)}</span>`
    : input.icon
      ? `<img class="mark-image" src="${escapeAttribute(input.icon)}" alt="">`
      : `<span class="mark-letter">T</span>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
  body { background: ${palette.surface}; }
  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding: 64px 72px 52px;
    overflow: hidden;
    color: ${palette.text};
    background: ${palette.surface};
    font-family: ${fontFamily}, Geist, monospace;
  }
  .grid {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(${alpha(palette.border, ".28")} 1px, transparent 1px),
      linear-gradient(90deg, ${alpha(palette.border, ".28")} 1px, transparent 1px);
    background-size: 30px 30px;
  }
  .glow {
    position: absolute;
    width: 760px;
    height: 760px;
    top: -390px;
    right: -170px;
    border-radius: 50%;
    background: radial-gradient(circle, ${alpha(palette.accent, ".24")}, ${alpha(palette.accent, "0")} 68%);
  }
  .accent {
    position: absolute;
    inset: 0 auto 0 0;
    width: 10px;
    background: ${palette.accent};
  }
  .content { position: relative; z-index: 1; display: flex; flex-direction: column; flex: 1; }
  .brand { display: flex; align-items: center; gap: 20px; }
  .mark {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 68px;
    height: 68px;
    overflow: hidden;
    border: 1px solid ${palette.border};
    border-radius: 18px;
    background: ${palette.surface2};
  }
  .mark-image { display: block; width: 68px; height: 68px; border-radius: 13px; object-fit: contain; }
  .mark-letter { color: ${palette.accent}; font-size: 42px; font-weight: 700; line-height: 1; }
  .mark-glyph {
    color: ${palette.accent};
    font-family: "Material Symbols Rounded";
    font-size: 46px;
    font-weight: normal;
    font-style: normal;
    font-feature-settings: "liga";
    font-variant-ligatures: normal;
    line-height: 1;
  }
  .eyebrow { color: ${palette.textSecondary}; font-size: 17px; font-weight: 700; letter-spacing: .08em; }
  .wordmark { margin-top: 5px; font-size: 38px; font-weight: 700; letter-spacing: -.04em; }
  h1 {
    max-width: 1000px;
    max-height: 215px;
    margin: 50px 0 0;
    color: ${palette.text};
    font-size: 68px;
    font-weight: 700;
    line-height: 1.03;
    letter-spacing: -.045em;
    white-space: pre-line;
  }
  p {
    max-width: 870px;
    max-height: 76px;
    margin: 22px 0 0;
    overflow: hidden;
    color: ${palette.textSecondary};
    font-size: 26px;
    font-weight: 400;
    line-height: 1.35;
  }
  .footer {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 14px;
    margin-top: auto;
    color: ${palette.textSecondary};
    font-size: 16px;
    line-height: 1.3;
  }
  .footer-line { width: 54px; height: 3px; background: ${palette.accent}; }
  .footer-dot { color: ${palette.accent}; }
  .footer-right { margin-left: auto; }
</style>
</head>
<body>
  <main class="card">
    <div class="grid"></div>
    <div class="glow"></div>
    <div class="accent"></div>
    <section class="content">
      <div class="brand">
        <div class="mark">${icon}</div>
        <div class="wordmark">${escapeHtml(input.siteName)}</div>
      </div>
      <h1>${escapeHtml(input.title)}</h1>
      <p>${escapeHtml(input.description)}</p>
    </section>
    <footer class="footer">
      <span class="footer-line"></span>
      <span class="footer-right">${escapeHtml(input.host)}</span>
    </footer>
  </main>
</body>
</html>`;
}

function cssFamily(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

/** Expand a six-digit color for the subtle grid and glow. */
function alpha(hex: string, opacity: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;

  const value = match[1]!;
  return `rgba(${parseInt(value.slice(0, 2), 16)},${parseInt(
    value.slice(2, 4),
    16,
  )},${parseInt(value.slice(4, 6), 16)},${opacity})`;
}
