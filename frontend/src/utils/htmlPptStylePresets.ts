import type { HtmlPptSlide } from "./htmlPptDeck";

export type HtmlPptStylePresetKey =
  | "editorial_studio"
  | "command_room"
  | "venture_system"
  | "field_notes"
  | "launch_kinetic"
  | "research_atlas";

export type HtmlPptStylePreset = {
  key: HtmlPptStylePresetKey;
  label: string;
  shortLabel: string;
  description: string;
  tags: string[];
  colors: {
    background: string;
    text: string;
    accent: string;
    secondary: string;
  };
  themeCss: string;
  promptGuidance: string;
  imagePrompt: string;
  previewSlide: Pick<HtmlPptSlide, "title" | "html" | "css">;
};

const sharedPreviewHtml = `<div class="preset-preview">
  <p class="ppt-kicker">Style System</p>
  <h1>From prompt to deck</h1>
  <p class="ppt-lede">A compact visual language for AI-generated HTML presentations.</p>
  <div class="ppt-stat-row">
    <div><strong>01</strong><span>Signal</span></div>
    <div><strong>02</strong><span>Structure</span></div>
    <div><strong>03</strong><span>Finish</span></div>
  </div>
</div>`;

const sharedPreviewCss = `.preset-preview {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 24px;
}
.preset-preview h1 {
  max-width: 780px;
}
.ppt-stat-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  max-width: 760px;
}
.ppt-stat-row > div {
  min-height: 92px;
  padding: 18px 20px;
  border-radius: 8px;
}
.ppt-stat-row strong,
.ppt-stat-row span {
  display: block;
}`;

export const HTML_PPT_STYLE_PRESETS: HtmlPptStylePreset[] = [
  {
    key: "editorial_studio",
    label: "Editorial Studio",
    shortLabel: "Editorial",
    description: "White editorial layout with strong typography and red accent marks.",
    tags: ["brand", "proposal", "story"],
    colors: {
      background: "#fbfbf8",
      text: "#171717",
      accent: "#e11d48",
      secondary: "#0f766e",
    },
    themeCss: `
.slide-root {
  padding: 76px 84px;
  background: #fbfbf8;
  color: #171717;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.slide-root::before {
  content: "";
  position: absolute;
  left: 84px;
  top: 42px;
  width: 96px;
  height: 4px;
  background: #e11d48;
}
.slide-root h1 {
  margin: 0;
  color: #171717;
  font-size: 64px;
  line-height: 1.02;
  font-weight: 820;
  letter-spacing: 0;
}
.slide-root h2 {
  margin: 0;
  color: #171717;
  font-size: 36px;
  line-height: 1.12;
  font-weight: 760;
}
.slide-root p {
  margin: 0;
  color: #525252;
  font-size: 22px;
  line-height: 1.45;
}
.slide-root .ppt-kicker {
  color: #e11d48;
  font-size: 13px;
  font-weight: 850;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.slide-root .ppt-lede {
  max-width: 680px;
  color: #404040;
}
.slide-root .ppt-stat-row > div {
  border: 1px solid #deded6;
  background: #ffffff;
}
.slide-root .ppt-stat-row strong {
  color: #e11d48;
  font-size: 32px;
  line-height: 1;
}
.slide-root .ppt-stat-row span {
  margin-top: 10px;
  color: #525252;
  font-size: 15px;
  font-weight: 700;
}
`.trim(),
    promptGuidance:
      "Use restrained editorial composition: large confident headlines, red rule accents, generous whitespace, sharp grids, and concise body copy. Avoid generic gradient hero cards.",
    imagePrompt:
      "Clean editorial presentation visual, natural whitespace, refined publication-style composition, no text or typography inside the image.",
    previewSlide: {
      title: "Editorial Studio",
      html: sharedPreviewHtml,
      css: sharedPreviewCss,
    },
  },
  {
    key: "command_room",
    label: "Command Room",
    shortLabel: "Command",
    description: "Dark operational dashboard style for strategy, metrics, and decisions.",
    tags: ["strategy", "metrics", "ops"],
    colors: {
      background: "#111111",
      text: "#f7f7f2",
      accent: "#84cc16",
      secondary: "#f59e0b",
    },
    themeCss: `
.slide-root {
  padding: 64px 72px;
  background: #111111;
  color: #f7f7f2;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.slide-root::after {
  content: "";
  position: absolute;
  inset: 28px;
  border: 1px solid rgba(132, 204, 22, 0.22);
  pointer-events: none;
}
.slide-root h1 {
  margin: 0;
  color: #f7f7f2;
  font-size: 58px;
  line-height: 1.02;
  font-weight: 780;
  letter-spacing: 0;
}
.slide-root h2 {
  margin: 0;
  color: #f7f7f2;
  font-size: 34px;
  line-height: 1.1;
  font-weight: 760;
}
.slide-root p {
  margin: 0;
  color: #b9c0ae;
  font-size: 21px;
  line-height: 1.45;
}
.slide-root .ppt-kicker {
  width: fit-content;
  padding: 7px 10px;
  border: 1px solid rgba(132, 204, 22, 0.42);
  color: #bef264;
  font-size: 12px;
  font-weight: 850;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.slide-root .ppt-lede {
  max-width: 720px;
}
.slide-root .ppt-stat-row > div {
  border: 1px solid rgba(132, 204, 22, 0.24);
  background: #181818;
}
.slide-root .ppt-stat-row strong {
  color: #84cc16;
  font-size: 32px;
  line-height: 1;
}
.slide-root .ppt-stat-row span {
  margin-top: 10px;
  color: #e5e7d8;
  font-size: 15px;
  font-weight: 700;
}
`.trim(),
    promptGuidance:
      "Use a dark command-center layout: crisp status rows, dense but readable grids, strong hierarchy, lime/amber signal accents, and no decorative blobs.",
    imagePrompt:
      "Dark premium operational visual, precise lighting, strategic command-room atmosphere, clean negative space, no text or interface labels.",
    previewSlide: {
      title: "Command Room",
      html: sharedPreviewHtml,
      css: sharedPreviewCss,
    },
  },
  {
    key: "venture_system",
    label: "Venture System",
    shortLabel: "Venture",
    description: "Product strategy language with structured grids and calm color contrast.",
    tags: ["product", "startup", "system"],
    colors: {
      background: "#f7faf9",
      text: "#10201d",
      accent: "#0f766e",
      secondary: "#2563eb",
    },
    themeCss: `
.slide-root {
  padding: 70px 78px;
  background: linear-gradient(135deg, #f7faf9 0%, #ffffff 58%, #edf7f4 100%);
  color: #10201d;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.slide-root h1 {
  margin: 0;
  color: #10201d;
  font-size: 60px;
  line-height: 1.04;
  font-weight: 800;
  letter-spacing: 0;
}
.slide-root h2 {
  margin: 0;
  color: #10201d;
  font-size: 34px;
  line-height: 1.12;
  font-weight: 760;
}
.slide-root p {
  margin: 0;
  color: #4b615c;
  font-size: 21px;
  line-height: 1.45;
}
.slide-root .ppt-kicker {
  color: #0f766e;
  font-size: 13px;
  font-weight: 850;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.slide-root .ppt-lede {
  max-width: 700px;
}
.slide-root .ppt-stat-row > div {
  border: 1px solid #d8e7e2;
  background: rgba(255, 255, 255, 0.84);
  box-shadow: 0 14px 28px rgba(15, 118, 110, 0.08);
}
.slide-root .ppt-stat-row strong {
  color: #0f766e;
  font-size: 32px;
  line-height: 1;
}
.slide-root .ppt-stat-row span {
  margin-top: 10px;
  color: #4b615c;
  font-size: 15px;
  font-weight: 720;
}
`.trim(),
    promptGuidance:
      "Use product-system clarity: modular grids, precise labels, crisp comparison blocks, calm teal and blue accents, and real information density.",
    imagePrompt:
      "Modern product strategy visual, clean system geometry, calm teal and blue accents, high-end SaaS presentation feel, no embedded text.",
    previewSlide: {
      title: "Venture System",
      html: sharedPreviewHtml,
      css: sharedPreviewCss,
    },
  },
  {
    key: "field_notes",
    label: "Field Notes",
    shortLabel: "Field",
    description: "Human research and case-study style with tactile panels and warm accents.",
    tags: ["case", "research", "human"],
    colors: {
      background: "#f6f8f3",
      text: "#1f2933",
      accent: "#dc5f3d",
      secondary: "#2f855a",
    },
    themeCss: `
.slide-root {
  padding: 70px 78px;
  background: #f6f8f3;
  color: #1f2933;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.slide-root h1 {
  margin: 0;
  color: #1f2933;
  font-size: 58px;
  line-height: 1.04;
  font-weight: 790;
  letter-spacing: 0;
}
.slide-root h2 {
  margin: 0;
  color: #1f2933;
  font-size: 33px;
  line-height: 1.14;
  font-weight: 760;
}
.slide-root p {
  margin: 0;
  color: #58645d;
  font-size: 21px;
  line-height: 1.48;
}
.slide-root .ppt-kicker {
  color: #dc5f3d;
  font-size: 13px;
  font-weight: 850;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.slide-root .ppt-lede {
  max-width: 700px;
}
.slide-root .ppt-stat-row > div {
  border: 1px solid #dfe7d8;
  background: #ffffff;
}
.slide-root .ppt-stat-row strong {
  color: #dc5f3d;
  font-size: 32px;
  line-height: 1;
}
.slide-root .ppt-stat-row span {
  margin-top: 10px;
  color: #58645d;
  font-size: 15px;
  font-weight: 720;
}
`.trim(),
    promptGuidance:
      "Use a case-study and research-note style: tactile white panels, measured annotations, warm orange accents, human-scale images, and clear insight blocks.",
    imagePrompt:
      "Human-centered case study visual, documentary but polished, warm orange and green accents, realistic scene, no text.",
    previewSlide: {
      title: "Field Notes",
      html: sharedPreviewHtml,
      css: sharedPreviewCss,
    },
  },
  {
    key: "launch_kinetic",
    label: "Launch Kinetic",
    shortLabel: "Launch",
    description: "High-energy launch deck style with sharp contrast and asymmetric blocks.",
    tags: ["launch", "campaign", "creative"],
    colors: {
      background: "#0b0b0f",
      text: "#ffffff",
      accent: "#f43f5e",
      secondary: "#22d3ee",
    },
    themeCss: `
.slide-root {
  padding: 64px 72px;
  background: #0b0b0f;
  color: #ffffff;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.slide-root::before {
  content: "";
  position: absolute;
  right: 0;
  top: 0;
  width: 36%;
  height: 100%;
  background: linear-gradient(180deg, rgba(244, 63, 94, 0.2), rgba(34, 211, 238, 0.14));
}
.slide-root h1 {
  margin: 0;
  color: #ffffff;
  font-size: 66px;
  line-height: 0.98;
  font-weight: 880;
  letter-spacing: 0;
}
.slide-root h2 {
  margin: 0;
  color: #ffffff;
  font-size: 36px;
  line-height: 1.08;
  font-weight: 820;
}
.slide-root p {
  margin: 0;
  color: #cbd5e1;
  font-size: 22px;
  line-height: 1.42;
}
.slide-root .ppt-kicker {
  color: #22d3ee;
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.slide-root .ppt-lede {
  max-width: 700px;
}
.slide-root .ppt-stat-row > div {
  border: 1px solid rgba(244, 63, 94, 0.32);
  background: rgba(255, 255, 255, 0.07);
}
.slide-root .ppt-stat-row strong {
  color: #f43f5e;
  font-size: 32px;
  line-height: 1;
}
.slide-root .ppt-stat-row span {
  margin-top: 10px;
  color: #f8fafc;
  font-size: 15px;
  font-weight: 760;
}
`.trim(),
    promptGuidance:
      "Use launch-deck energy: asymmetric sections, sharp contrast, red/cyan accents, bold headlines, image-led hero areas, and tight copy.",
    imagePrompt:
      "Bold launch campaign visual, cinematic lighting, red and cyan accents, asymmetric composition, room for headline overlay, no text.",
    previewSlide: {
      title: "Launch Kinetic",
      html: sharedPreviewHtml,
      css: sharedPreviewCss,
    },
  },
  {
    key: "research_atlas",
    label: "Research Atlas",
    shortLabel: "Atlas",
    description: "Analytical report style for findings, maps, comparisons, and timelines.",
    tags: ["report", "analysis", "findings"],
    colors: {
      background: "#f4f7fb",
      text: "#172033",
      accent: "#2563eb",
      secondary: "#f97316",
    },
    themeCss: `
.slide-root {
  padding: 68px 76px;
  background: #f4f7fb;
  color: #172033;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.slide-root h1 {
  margin: 0;
  color: #172033;
  font-size: 58px;
  line-height: 1.04;
  font-weight: 820;
  letter-spacing: 0;
}
.slide-root h2 {
  margin: 0;
  color: #172033;
  font-size: 34px;
  line-height: 1.12;
  font-weight: 780;
}
.slide-root p {
  margin: 0;
  color: #556175;
  font-size: 21px;
  line-height: 1.46;
}
.slide-root .ppt-kicker {
  color: #2563eb;
  font-size: 13px;
  font-weight: 850;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.slide-root .ppt-lede {
  max-width: 720px;
}
.slide-root .ppt-stat-row > div {
  border: 1px solid #d9e2ef;
  background: #ffffff;
}
.slide-root .ppt-stat-row strong {
  color: #2563eb;
  font-size: 32px;
  line-height: 1;
}
.slide-root .ppt-stat-row span {
  margin-top: 10px;
  color: #556175;
  font-size: 15px;
  font-weight: 740;
}
`.trim(),
    promptGuidance:
      "Use analytical report structure: clear evidence hierarchy, compact charts drawn with HTML/CSS, blue/orange signal accents, and precise section labels.",
    imagePrompt:
      "Analytical report visual, abstract map or evidence-board composition, blue and orange signal accents, clean negative space, no text.",
    previewSlide: {
      title: "Research Atlas",
      html: sharedPreviewHtml,
      css: sharedPreviewCss,
    },
  },
];

export const DEFAULT_HTML_PPT_STYLE_PRESET_KEY: HtmlPptStylePresetKey =
  "editorial_studio";

export const findHtmlPptStylePreset = (
  key?: string | null
): HtmlPptStylePreset | null =>
  HTML_PPT_STYLE_PRESETS.find((preset) => preset.key === key) || null;

export const getHtmlPptStylePreset = (
  key?: string | null
): HtmlPptStylePreset =>
  findHtmlPptStylePreset(key) ||
  HTML_PPT_STYLE_PRESETS.find(
    (preset) => preset.key === DEFAULT_HTML_PPT_STYLE_PRESET_KEY
  ) ||
  HTML_PPT_STYLE_PRESETS[0];
