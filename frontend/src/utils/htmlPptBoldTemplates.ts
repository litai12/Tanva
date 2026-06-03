import type { HtmlPptSlide } from "./htmlPptDeck";
import { findHtmlPptBeautifulTemplateDeck } from "./htmlPptBeautifulTemplateDecks";

export type HtmlPptBoldTemplateSlug =
  | "8-bit-orbit"
  | "biennale-yellow"
  | "block-frame"
  | "blue-professional"
  | "bold-poster"
  | "broadside"
  | "capsule"
  | "cartesian"
  | "cobalt-grid"
  | "coral"
  | "creative-mode"
  | "daisy-days"
  | "editorial-forest"
  | "editorial-tri-tone"
  | "emerald-editorial"
  | "grove"
  | "long-table"
  | "mat"
  | "monochrome"
  | "neo-grid-bold"
  | "peoples-platform"
  | "pin-and-paper"
  | "pink-script"
  | "playful"
  | "raw-grid"
  | "retro-windows"
  | "retro-zine"
  | "sakura-chroma"
  | "scatterbrain"
  | "signal"
  | "soft-editorial"
  | "stencil-tablet"
  | "studio"
  | "vellum";

export type HtmlPptBoldTemplate = {
  slug: HtmlPptBoldTemplateSlug;
  name: string;
  tagline: string;
  mood: string[];
  tone: string[];
  formality: "low" | "medium-low" | "medium" | "medium-high" | "high";
  density: "low" | "medium" | "medium-high" | "high";
  scheme: "light" | "dark" | "mixed";
  bestFor: string;
  avoidFor: string;
  source: {
    previewMd: string;
    designMd: string;
    templateHtml: string;
    upstreamUrl: string;
  };
  colors: {
    background: string;
    text: string;
    accent: string;
    secondary: string;
    panel: string;
  };
  themeCss: string;
  promptGuidance: string;
  imagePrompt: string;
  previewSlide: Pick<HtmlPptSlide, "title" | "html" | "css">;
  previewSlides: Array<Pick<HtmlPptSlide, "title" | "html" | "css">>;
  previewSlideIndexes: number[];
  starterSlides: Array<Pick<HtmlPptSlide, "title" | "html" | "css" | "notes">>;
};

type BoldTemplateSeed = Omit<
  HtmlPptBoldTemplate,
  | "themeCss"
  | "promptGuidance"
  | "imagePrompt"
  | "previewSlide"
  | "previewSlides"
  | "previewSlideIndexes"
  | "starterSlides"
>;

const isSerifTemplate = (seed: BoldTemplateSeed): boolean =>
  [...seed.mood, ...seed.tone].some((tag) =>
    /(editorial|literary|classical|scholarly|archival|institutional|museum|elegant)/i.test(tag)
  );

const isMonoTemplate = (seed: BoldTemplateSeed): boolean =>
  [...seed.mood, ...seed.tone, seed.name].some((tag) =>
    /(retro-tech|pixel|geeky|windows|arcade|tech-print|monochrome)/i.test(tag)
  );

const fontStackForSeed = (seed: BoldTemplateSeed): string => {
  if (isMonoTemplate(seed)) {
    return 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
  }
  if (isSerifTemplate(seed)) {
    return 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif';
  }
  return 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
};

const radiusForSeed = (seed: BoldTemplateSeed): number => {
  if (seed.mood.includes("playful") || seed.tone.includes("playful")) return 20;
  if (seed.mood.includes("raw") || seed.tone.includes("graphic")) return 4;
  if (seed.formality === "high") return 2;
  return 10;
};

const paddingForDensity = (density: HtmlPptBoldTemplate["density"]): number => {
  if (density === "high") return 58;
  if (density === "medium-high") return 62;
  if (density === "low") return 82;
  return 70;
};

const headingSizeForDensity = (density: HtmlPptBoldTemplate["density"]): number => {
  if (density === "high") return 54;
  if (density === "medium-high") return 58;
  if (density === "low") return 72;
  return 64;
};

const buildThemeCss = (seed: BoldTemplateSeed): string => {
  const padding = paddingForDensity(seed.density);
  const headingSize = headingSizeForDensity(seed.density);
  const radius = radiusForSeed(seed);
  const textAlphaBorder = seed.scheme === "dark" ? "rgba(255,255,255,0.22)" : "rgba(17,24,39,0.16)";
  const panelShadow =
    seed.scheme === "dark"
      ? "0 18px 40px rgba(0,0,0,0.22)"
      : "0 18px 38px rgba(15,23,42,0.08)";
  const fontStack = fontStackForSeed(seed);

  return `
.slide-root {
  padding: ${padding}px;
  background: ${seed.colors.background};
  color: ${seed.colors.text};
  font-family: ${fontStack};
  --bold-accent: ${seed.colors.accent};
  --bold-secondary: ${seed.colors.secondary};
}
.slide-root::before {
  content: "";
  position: absolute;
  left: ${padding}px;
  top: 42px;
  width: 110px;
  height: ${seed.scheme === "dark" ? 3 : 4}px;
  background: ${seed.colors.accent};
}
.slide-root::after {
  content: "";
  position: absolute;
  right: ${Math.max(28, Math.round(padding * 0.58))}px;
  bottom: ${Math.max(28, Math.round(padding * 0.58))}px;
  width: 156px;
  height: 156px;
  border: 1px solid ${textAlphaBorder};
  background: linear-gradient(135deg, ${seed.colors.accent}22, ${seed.colors.secondary}22);
  pointer-events: none;
}
.slide-root h1 {
  margin: 0;
  max-width: 980px;
  color: ${seed.colors.text};
  font-size: ${headingSize}px;
  line-height: ${seed.density === "low" ? 0.98 : 1.03};
  font-weight: ${isSerifTemplate(seed) ? 620 : 850};
  letter-spacing: 0;
}
.slide-root h2 {
  margin: 0;
  color: ${seed.colors.text};
  font-size: ${Math.max(32, Math.round(headingSize * 0.54))}px;
  line-height: 1.1;
  font-weight: ${isSerifTemplate(seed) ? 620 : 780};
}
.slide-root p {
  margin: 0;
  max-width: 760px;
  color: ${seed.scheme === "dark" ? "#cbd5e1" : "#566175"};
  font-size: ${seed.density === "high" ? 19 : 21}px;
  line-height: 1.45;
}
.slide-root .ppt-kicker,
.slide-root .bold-kicker {
  width: fit-content;
  color: ${seed.colors.accent};
  font-size: 13px;
  font-weight: 850;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.slide-root .ppt-lede,
.slide-root .bold-lede {
  max-width: 760px;
}
.slide-root .ppt-stat-row,
.slide-root .bold-card-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: ${seed.density === "high" ? 12 : 16}px;
}
.slide-root .ppt-stat-row > div,
.slide-root .bold-card-grid > div {
  min-height: ${seed.density === "high" ? 96 : 112}px;
  padding: ${seed.density === "high" ? 18 : 22}px;
  border: 1px solid ${textAlphaBorder};
  border-radius: ${radius}px;
  background: ${seed.colors.panel};
  box-shadow: ${panelShadow};
}
.slide-root .ppt-stat-row strong,
.slide-root .bold-card-grid strong {
  display: block;
  color: ${seed.colors.accent};
  font-size: ${seed.density === "low" ? 38 : 32}px;
  line-height: 1;
}
.slide-root .ppt-stat-row span,
.slide-root .bold-card-grid span {
  display: block;
  margin-top: 10px;
  color: ${seed.scheme === "dark" ? "#e5e7eb" : "#475569"};
  font-size: 15px;
  font-weight: 720;
}
.slide-root .bold-split {
  height: 100%;
  display: grid;
  grid-template-columns: ${seed.density === "low" ? "1fr 0.8fr" : "1fr 1fr"};
  gap: 34px;
  align-items: center;
}
`.trim();
};

const buildPromptGuidance = (seed: BoldTemplateSeed): string =>
  [
    `Use the beautiful-html-templates "${seed.name}" starter deck as the visual system.`,
    seed.tagline,
    `Mood: ${seed.mood.join(", ")}. Tone: ${seed.tone.join(", ")}.`,
    `Formality: ${seed.formality}. Density: ${seed.density}. Scheme: ${seed.scheme}.`,
    `Best for: ${seed.bestFor}`,
    `Avoid this look when: ${seed.avoidFor}`,
    "Preserve the selected template's original class structure, typography, spacing rhythm, and 1920x1080 fixed-stage composition unless the user explicitly asks for a different direction.",
    "Translate the template into Tanva-safe slide fragments: no scripts, no event handlers, no iframe/object/embed/base tags, no data/blob/base64 assets.",
    "Use fixed-stage PPT composition with strong hierarchy, deliberate whitespace, and no responsive reflow inside slides.",
  ].join("\n");

const buildImagePrompt = (seed: BoldTemplateSeed): string =>
  [
    `Visual asset should match "${seed.name}": ${seed.tagline}`,
    `Mood: ${seed.mood.join(", ")}. Palette anchor: ${seed.colors.background}, ${seed.colors.accent}, ${seed.colors.secondary}.`,
    "No readable text, no typography, no logo, no watermark. Leave negative space for HTML text overlays.",
  ].join(" ");

const buildPreviewSlides = (
  seed: BoldTemplateSeed
): Array<Pick<HtmlPptSlide, "title" | "html" | "css">> => [
  {
    title: `${seed.name} Cover`,
    html: `<div class="bold-example bold-cover">
  <p class="bold-kicker">${seed.name}</p>
  <h1>${seed.scheme === "dark" ? "Signals after dark" : "Quarterly Review 2026"}</h1>
  <p class="bold-lede">${seed.tagline}</p>
  <div class="bold-meta">
    <span>${seed.mood[0] || "system"}</span>
    <span>${seed.tone[0] || "visual"}</span>
    <span>${seed.density}</span>
  </div>
</div>`,
    css: `.bold-example {
  height: 100%;
  position: relative;
  z-index: 1;
}
.bold-cover {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 24px;
}
.bold-cover h1 {
  max-width: 820px;
}
.bold-meta {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.bold-meta span {
  padding: 8px 12px;
  border: 1px solid currentColor;
  border-radius: 999px;
  color: inherit;
  font-size: 13px;
  font-weight: 760;
  opacity: 0.82;
}`,
  },
  {
    title: `${seed.name} Structure`,
    html: `<div class="bold-example bold-structure">
  <div>
    <p class="bold-kicker">Insights</p>
    <h1>What changed in the system</h1>
  </div>
  <div class="bold-card-grid">
    <div><strong>01</strong><span>Trust is the onboarding moment</span></div>
    <div><strong>02</strong><span>Power users read upgrades first</span></div>
    <div><strong>03</strong><span>Support is product feedback</span></div>
  </div>
</div>`,
    css: `.bold-structure {
  height: 100%;
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 28px;
}
.bold-structure h1 {
  max-width: 760px;
}
.bold-structure .bold-card-grid {
  align-self: end;
}
.bold-structure .bold-card-grid > div {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.bold-structure .bold-card-grid span {
  max-width: 210px;
}`,
  },
  {
    title: `${seed.name} Metrics`,
    html: `<div class="bold-example bold-metrics">
  <div class="bold-metric-copy">
    <p class="bold-kicker">By the numbers</p>
    <h1>The curve bends around day three.</h1>
    <p class="bold-lede">Retention lifts when onboarding, support, and habit loops are framed as one experience.</p>
  </div>
  <div class="bold-chart-card">
    <div class="bold-big-number">68%</div>
    <div class="bold-bars">
      <span style="height: 46%"></span>
      <span style="height: 62%"></span>
      <span style="height: 74%"></span>
      <span style="height: 84%"></span>
      <span style="height: 92%"></span>
    </div>
    <div class="bold-chart-labels"><span>D1</span><span>D3</span><span>D7</span><span>D14</span><span>D30</span></div>
  </div>
</div>`,
    css: `.bold-metrics {
  height: 100%;
  display: grid;
  grid-template-columns: 0.9fr 1.1fr;
  align-items: center;
  gap: 34px;
}
.bold-metric-copy {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.bold-chart-card {
  min-height: 360px;
  padding: 28px;
  border: 1px solid currentColor;
  border-radius: 10px;
  background: color-mix(in srgb, currentColor 6%, transparent);
}
.bold-big-number {
  color: var(--bold-accent, currentColor);
  font-size: 82px;
  line-height: 0.9;
  font-weight: 820;
}
.bold-bars {
  height: 164px;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
  align-items: end;
  margin-top: 34px;
}
.bold-bars span {
  display: block;
  min-height: 18px;
  background: currentColor;
  opacity: 0.82;
}
.bold-chart-labels {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
  margin-top: 12px;
  font-size: 12px;
  font-weight: 760;
  opacity: 0.72;
}`,
  },
];

const makeTemplate = (seed: BoldTemplateSeed): HtmlPptBoldTemplate => {
  const beautifulDeck = findHtmlPptBeautifulTemplateDeck(seed.slug);
  const fallbackPreviewSlides = buildPreviewSlides(seed);
  const previewSlides =
    beautifulDeck?.previewSlideIndexes.length
      ? beautifulDeck.previewSlideIndexes
          .map((index) => beautifulDeck.slides[index])
          .filter(Boolean)
      : fallbackPreviewSlides;
  return {
    ...seed,
    themeCss: beautifulDeck?.themeCss || buildThemeCss(seed),
    promptGuidance: buildPromptGuidance(seed),
    imagePrompt: buildImagePrompt(seed),
    previewSlide: previewSlides[0],
    previewSlides,
    previewSlideIndexes: beautifulDeck?.previewSlideIndexes || [0, 1, 2],
    starterSlides: beautifulDeck?.slides || [],
  };
};

const sourceFor = (slug: HtmlPptBoldTemplateSlug) => ({
  previewMd: "beautiful-html-templates/README.md",
  designMd: `beautiful-html-templates/templates/${slug}/design.md`,
  templateHtml: `beautiful-html-templates/templates/${slug}/template.html`,
  upstreamUrl: `https://github.com/zarazhangrui/beautiful-html-templates/tree/main/templates/${slug}`,
});

export const HTML_PPT_BOLD_TEMPLATES: HtmlPptBoldTemplate[] = [
  makeTemplate({
    slug: "8-bit-orbit",
    name: "8-Bit Orbit",
    tagline: "Pixel-art neon arcade aesthetic on a deep navy void.",
    mood: ["retro-tech", "playful", "cyberpunk", "energetic"],
    tone: ["geeky", "neon", "rebellious", "sci-fi"],
    formality: "low",
    density: "medium",
    scheme: "dark",
    bestFor: "Cyberpunk, gaming, web3, indie dev tools, hackathon demos, synthwave brand decks, and nostalgic tech talks.",
    avoidFor: "Quiet institutional finance, healthcare patient-facing materials, and traditional luxury.",
    source: sourceFor("8-bit-orbit"),
    colors: { background: "#07111f", text: "#f8fbff", accent: "#7df9ff", secondary: "#ff2fd6", panel: "rgba(13, 25, 45, 0.92)" },
  }),
  makeTemplate({
    slug: "biennale-yellow",
    name: "Biennale Yellow",
    tagline: "Solar yellow on warm parchment with deep indigo serif and atmospheric sun-glow gradients.",
    mood: ["editorial", "atmospheric", "warm", "cultural-institution", "poster-like"],
    tone: ["literary", "considered", "contemplative", "warm-modern", "Dutch-editorial"],
    formality: "high",
    density: "medium",
    scheme: "light",
    bestFor: "Exhibition decks, arts-institution announcements, design conference brochures, curatorial pitches, and studio retrospectives.",
    avoidFor: "Decks that need saturated multi-color energy or visual punch.",
    source: sourceFor("biennale-yellow"),
    colors: { background: "#f6e7a8", text: "#152349", accent: "#f2c500", secondary: "#1d2d68", panel: "rgba(255, 249, 222, 0.86)" },
  }),
  makeTemplate({
    slug: "block-frame",
    name: "BlockFrame",
    tagline: "Neobrutalist deck with pastel-neon color blocks and chunky black borders.",
    mood: ["bold", "playful", "graphic", "fresh"],
    tone: ["confident", "graphic", "pop", "design-led"],
    formality: "medium-low",
    density: "high",
    scheme: "light",
    bestFor: "Indie SaaS launches, agency credentials, creative reviews, brand redesigns, and confident contemporary research.",
    avoidFor: "Regulated disclosures or formal legal briefs that require quiet institutional restraint.",
    source: sourceFor("block-frame"),
    colors: { background: "#fbf4dd", text: "#111111", accent: "#ff6b6b", secondary: "#a3e635", panel: "#ffffff" },
  }),
  makeTemplate({
    slug: "blue-professional",
    name: "Blue Professional",
    tagline: "Cream paper background with electric cobalt blue accents; clean modern professional.",
    mood: ["professional", "modern", "calm", "trustworthy"],
    tone: ["clean", "considered", "polished", "neutral"],
    formality: "medium-high",
    density: "medium",
    scheme: "light",
    bestFor: "B2B SaaS pitches, consulting deliverables, advisory updates, investor reports, and research synthesis.",
    avoidFor: "Decks that should feel hot, playful, or intentionally informal.",
    source: sourceFor("blue-professional"),
    colors: { background: "#f7f0de", text: "#172033", accent: "#1155ff", secondary: "#6b7ea3", panel: "#fffaf0" },
  }),
  makeTemplate({
    slug: "bold-poster",
    name: "Bold Poster",
    tagline: "Editorial poster aesthetic with massive display type and a single fire-engine red accent.",
    mood: ["bold", "editorial", "loud", "confident"],
    tone: ["dramatic", "graphic", "sharp", "intentional"],
    formality: "medium",
    density: "low",
    scheme: "light",
    bestFor: "Brand manifestos, founder vision decks, editorial or cultural pitches, creative reviews, and quotable keynote moments.",
    avoidFor: "Dense information slides with paragraphs of detail.",
    source: sourceFor("bold-poster"),
    colors: { background: "#fff8e7", text: "#171717", accent: "#f21b1b", secondary: "#111111", panel: "#ffffff" },
  }),
  makeTemplate({
    slug: "broadside",
    name: "Broadside",
    tagline: "Dark editorial canvas with a single fire orange accent and bilingual newspaper energy.",
    mood: ["editorial", "dramatic", "loud", "newspaper"],
    tone: ["graphic", "punchy", "literary", "considered"],
    formality: "medium-high",
    density: "medium",
    scheme: "dark",
    bestFor: "Broadside newspaper-style manifestos, magazine pitches, design talks, bilingual decks, and founder vision statements.",
    avoidFor: "Decks that need to feel quiet, warm, or institutionally traditional.",
    source: sourceFor("broadside"),
    colors: { background: "#14110f", text: "#f5eadb", accent: "#ff5a1f", secondary: "#f5eadb", panel: "rgba(255, 90, 31, 0.12)" },
  }),
  makeTemplate({
    slug: "capsule",
    name: "Capsule",
    tagline: "Modular pill-shaped cards on warm bone with a full pastel-pop palette.",
    mood: ["playful", "modern", "warm", "fresh", "fun"],
    tone: ["upbeat", "graphic", "approachable", "cool"],
    formality: "medium-low",
    density: "medium",
    scheme: "light",
    bestFor: "Lifestyle brands, creator portfolios, DTC launches, beauty and wellness, agency credentials, and playful tech demos.",
    avoidFor: "Contexts that require traditional institutional weight.",
    source: sourceFor("capsule"),
    colors: { background: "#f6ead7", text: "#242126", accent: "#ff7ac8", secondary: "#59c3ff", panel: "#fff9ef" },
  }),
  makeTemplate({
    slug: "cartesian",
    name: "Cartesian",
    tagline: "Quiet warm-neutral palette with classical serifs; tasteful and unhurried.",
    mood: ["quiet", "considered", "elegant", "warm-minimal"],
    tone: ["classical", "literary", "restrained", "confident-quiet"],
    formality: "high",
    density: "low",
    scheme: "light",
    bestFor: "Investment theses, white papers, advisory work, longform research, gallery decks, and founder reflections.",
    avoidFor: "Decks that need visual heat, multiple accents, or urgency.",
    source: sourceFor("cartesian"),
    colors: { background: "#f3ead9", text: "#1c1a17", accent: "#8a6a45", secondary: "#a5a08d", panel: "#fff8eb" },
  }),
  makeTemplate({
    slug: "cobalt-grid",
    name: "Cobalt Grid",
    tagline: "Electric cobalt serifs on a graph-paper canvas with pixel-glitch decorations.",
    mood: ["editorial", "design-research", "studious", "modernist", "tech-print", "monochrome"],
    tone: ["considered", "literary", "studious", "quietly-modern", "editorial"],
    formality: "high",
    density: "medium",
    scheme: "light",
    bestFor: "Design research bulletins, art publications, trend reports, architecture, academic decks, and studio annuals.",
    avoidFor: "Decks that need warmth, multi-color energy, or a casual playful voice.",
    source: sourceFor("cobalt-grid"),
    colors: { background: "#f5f2e8", text: "#1438ff", accent: "#1438ff", secondary: "#202a44", panel: "#fffdf4" },
  }),
  makeTemplate({
    slug: "coral",
    name: "Coral",
    tagline: "Cream and coral on near-black, set with oversized magazine energy.",
    mood: ["bold", "warm", "modern", "confident"],
    tone: ["graphic", "punchy", "magazine"],
    formality: "medium",
    density: "medium",
    scheme: "mixed",
    bestFor: "Fashion, beauty, fitness, F&B, lifestyle brands, creator portfolios, manifestos, and warm tech decks.",
    avoidFor: "Quiet or institutional contexts.",
    source: sourceFor("coral"),
    colors: { background: "#111111", text: "#fff2df", accent: "#ff6f61", secondary: "#fff2df", panel: "rgba(255, 242, 223, 0.12)" },
  }),
  makeTemplate({
    slug: "creative-mode",
    name: "Creative Mode",
    tagline: "Cream paper canvas with confident multi-color accents and heavy display type.",
    mood: ["creative", "confident", "playful", "design-led"],
    tone: ["graphic", "expressive", "modern"],
    formality: "medium",
    density: "medium-high",
    scheme: "light",
    bestFor: "Creative agency pitches, design studio decks, ad shop credentials, brand creative reviews, and art-direction reviews.",
    avoidFor: "Institutional restraint and quiet authority.",
    source: sourceFor("creative-mode"),
    colors: { background: "#fff4df", text: "#1c1c1c", accent: "#2fbf71", secondary: "#ff6b3d", panel: "#ffffff" },
  }),
  makeTemplate({
    slug: "daisy-days",
    name: "Daisy Days",
    tagline: "Cheerful pastel deck with hand-drawn daisies, stars, and rainbows.",
    mood: ["cheerful", "playful", "warm", "sunny", "wholesome"],
    tone: ["friendly", "soft", "encouraging", "approachable", "lighthearted"],
    formality: "low",
    density: "medium",
    scheme: "light",
    bestFor: "Educational content, kids and family, wellness programs, community workshops, craft portfolios, and warm kickoff decks.",
    avoidFor: "Audiences expecting authority and precision.",
    source: sourceFor("daisy-days"),
    colors: { background: "#fff7d6", text: "#44352e", accent: "#ffb703", secondary: "#f497c2", panel: "#fffdf2" },
  }),
  makeTemplate({
    slug: "editorial-forest",
    name: "Editorial Forest",
    tagline: "Forest green, dusty pink, and warm cream in a quiet quarterly-review deck.",
    mood: ["editorial", "quiet", "considered", "warm", "intentional"],
    tone: ["literary", "thoughtful", "warm", "low-pressure"],
    formality: "medium",
    density: "medium",
    scheme: "mixed",
    bestFor: "Quarterly reviews, internal readouts, studio updates, creative-agency presentations, research recaps, and team retrospectives.",
    avoidFor: "Urgent, punchy, or sales-driven decks.",
    source: sourceFor("editorial-forest"),
    colors: { background: "#294f2d", text: "#f6ead6", accent: "#e99ab1", secondary: "#d5c9a3", panel: "rgba(246, 234, 214, 0.12)" },
  }),
  makeTemplate({
    slug: "editorial-tri-tone",
    name: "Editorial Tri-Tone",
    tagline: "Dusty pink, mustard cream, and deep burgundy in a styled editorial system.",
    mood: ["editorial", "warm", "intentional", "moody"],
    tone: ["literary", "warm", "considered", "stylish"],
    formality: "medium-high",
    density: "medium",
    scheme: "mixed",
    bestFor: "Fashion-magazine spreads, editorial pitches, lifestyle media, art direction reviews, and styled business decks.",
    avoidFor: "Decks that need to read as soft or comforting.",
    source: sourceFor("editorial-tri-tone"),
    colors: { background: "#f4d7b6", text: "#3a1420", accent: "#d889a6", secondary: "#7b1e3d", panel: "rgba(255, 248, 230, 0.72)" },
  }),
  makeTemplate({
    slug: "emerald-editorial",
    name: "Emerald Editorial",
    tagline: "Magazine-cover business deck with emerald, navy, paper, and editorial gravitas.",
    mood: ["editorial", "considered", "confident", "magazine-cover"],
    tone: ["literary", "authoritative", "warm", "designed"],
    formality: "medium-high",
    density: "medium",
    scheme: "mixed",
    bestFor: "Leadership readouts, planning-office reviews, strategy briefings, product launches, and research recaps.",
    avoidFor: "Quiet, neutral, or institutionally restrained contexts.",
    source: sourceFor("emerald-editorial"),
    colors: { background: "#0f4d3d", text: "#fff4df", accent: "#d7b46a", secondary: "#10213b", panel: "rgba(255, 244, 223, 0.12)" },
  }),
  makeTemplate({
    slug: "grove",
    name: "Grove",
    tagline: "Forest-green canvas with cream type, classical serifs, and a single rust accent.",
    mood: ["organic", "considered", "warm", "literary", "natural"],
    tone: ["classical", "warm", "considered", "patient"],
    formality: "medium-high",
    density: "medium",
    scheme: "mixed",
    bestFor: "Sustainability, wellness, outdoor products, wineries, restaurants, literary decks, arts decks, and calm business reports.",
    avoidFor: "Neon energy or rapid-fire pop.",
    source: sourceFor("grove"),
    colors: { background: "#21442b", text: "#f7eddb", accent: "#b85c38", secondary: "#e1c78f", panel: "rgba(247, 237, 219, 0.12)" },
  }),
  makeTemplate({
    slug: "long-table",
    name: "Long Table",
    tagline: "Warm cream and rust-red supper-club aesthetic with modern editorial warmth.",
    mood: ["warm", "intimate", "modern", "friendly", "small-batch", "social", "hospitality"],
    tone: ["warm", "playful", "considered", "social", "magazine-friendly", "modern-editorial"],
    formality: "medium",
    density: "medium",
    scheme: "light",
    bestFor: "Supper clubs, small restaurants, creative-studio events, membership pitches, lifestyle brands, wine brands, and social decks.",
    avoidFor: "Corporate polish, technical density, or cold minimalist registers.",
    source: sourceFor("long-table"),
    colors: { background: "#fff1d8", text: "#2c1f18", accent: "#b33b24", secondary: "#5a3a2a", panel: "#fff9ec" },
  }),
  makeTemplate({
    slug: "mat",
    name: "Mat",
    tagline: "Dark sage canvas with bone paper and burnt-orange accent; mid-century modern.",
    mood: ["warm-modern", "considered", "tactile", "mid-century"],
    tone: ["warm", "design-led", "intentional", "considered"],
    formality: "medium",
    density: "medium",
    scheme: "mixed",
    bestFor: "Design studio credentials, architecture, interiors, ceramics, craft, furniture, advisory decks, and analog-feeling business decks.",
    avoidFor: "Fast tech energy or institutional restraint.",
    source: sourceFor("mat"),
    colors: { background: "#31463a", text: "#f3ead8", accent: "#cf6b2e", secondary: "#d8c5a0", panel: "rgba(243, 234, 216, 0.13)" },
  }),
  makeTemplate({
    slug: "monochrome",
    name: "Monochrome",
    tagline: "Ivory ledger paper with all-black type; no color at all.",
    mood: ["restrained", "literary", "archival", "ledger"],
    tone: ["literary", "considered", "neutral", "honest"],
    formality: "high",
    density: "high",
    scheme: "light",
    bestFor: "User research synthesis, white papers, longform reports, academic and policy briefs, advisory deliverables, and text-led decks.",
    avoidFor: "Decks that need visual personality or color-led storytelling.",
    source: sourceFor("monochrome"),
    colors: { background: "#fbf5e7", text: "#111111", accent: "#111111", secondary: "#6b6b6b", panel: "#fffdf6" },
  }),
  makeTemplate({
    slug: "neo-grid-bold",
    name: "Neo-Grid Bold",
    tagline: "Editorial neo-brutalism with a single neon yellow accent on off-white paper.",
    mood: ["confident", "punchy", "editorial", "modern"],
    tone: ["bold", "minimal", "design-led", "graphic"],
    formality: "medium",
    density: "high",
    scheme: "light",
    bestFor: "Design-led pitches, brand work, founder talks, conference keynotes, stat-heavy slides, comparisons, and process flows.",
    avoidFor: "Quiet, traditional, or warm contexts.",
    source: sourceFor("neo-grid-bold"),
    colors: { background: "#f8f5e8", text: "#111111", accent: "#d7ff00", secondary: "#111111", panel: "#ffffff" },
  }),
  makeTemplate({
    slug: "peoples-platform",
    name: "People's Platform",
    tagline: "Activist poster energy: blue, orange, red on cream, loud and graphic.",
    mood: ["activist", "loud", "graphic", "honest"],
    tone: ["punchy", "direct", "expressive", "warm-bold"],
    formality: "medium-low",
    density: "medium-high",
    scheme: "light",
    bestFor: "Cultural commentary, manifestos, civic decks, community decks, design talks, campaign pitches, and mission statements.",
    avoidFor: "Institutional restraint.",
    source: sourceFor("peoples-platform"),
    colors: { background: "#fff2cf", text: "#141414", accent: "#f04e23", secondary: "#1f5eff", panel: "#ffffff" },
  }),
  makeTemplate({
    slug: "pin-and-paper",
    name: "Pin & Paper",
    tagline: "Yellow paper with safety-pin craft energy and ink-blue handwritten warmth.",
    mood: ["crafted", "handmade", "warm", "thoughtful", "literary"],
    tone: ["literary", "intimate", "warm", "grounded"],
    formality: "medium",
    density: "medium",
    scheme: "light",
    bestFor: "Qualitative research, founder reflections, longform brand stories, workshop debriefs, and warm personality-led decks.",
    avoidFor: "Digital-native polish or rigorously data-driven decks.",
    source: sourceFor("pin-and-paper"),
    colors: { background: "#f7dc61", text: "#17345c", accent: "#17345c", secondary: "#9b5a2e", panel: "rgba(255, 248, 206, 0.78)" },
  }),
  makeTemplate({
    slug: "pink-script",
    name: "Pink Script",
    tagline: "Black canvas, hot pink accent, and pearl-cream late-night editorial luxury.",
    mood: ["nocturnal", "moody", "intentional", "luxe", "expressive"],
    tone: ["literary", "sultry", "considered", "magazine"],
    formality: "medium-high",
    density: "low",
    scheme: "dark",
    bestFor: "Fashion brand decks, creator personal brands, nightlife, spirits launches, luxury reveals, editorial features, and magnetic keynotes.",
    avoidFor: "Daytime corporate-professional and traditional B2B contexts.",
    source: sourceFor("pink-script"),
    colors: { background: "#09080b", text: "#fff2ea", accent: "#ff2f92", secondary: "#f4c7d9", panel: "rgba(255, 47, 146, 0.12)" },
  }),
  makeTemplate({
    slug: "playful",
    name: "Playful",
    tagline: "Sun-warm peach background with a friendly indie launch-deck voice.",
    mood: ["warm", "approachable", "indie", "friendly"],
    tone: ["upbeat", "informal", "welcoming"],
    formality: "low",
    density: "medium",
    scheme: "light",
    bestFor: "Creator portfolios, indie product launches, lifestyle brands, small-business pitches, newsletter decks, and community decks.",
    avoidFor: "Contexts where institutional credibility matters more than warmth.",
    source: sourceFor("playful"),
    colors: { background: "#ffd9b6", text: "#2d1f1a", accent: "#ff7a1a", secondary: "#7c3aed", panel: "rgba(255, 255, 255, 0.7)" },
  }),
  makeTemplate({
    slug: "raw-grid",
    name: "Raw Grid",
    tagline: "Neo-brutalist deck with thick borders, offset shadows, and pink/sage/ink palette.",
    mood: ["raw", "punchy", "energetic", "confident"],
    tone: ["direct", "modern", "no-nonsense", "graphic"],
    formality: "medium-low",
    density: "high",
    scheme: "light",
    bestFor: "Founder pitches, accelerator demos, brand decks, indie launches, creator portfolios, stat slides, comparisons, and flows.",
    avoidFor: "Soft, warm, or intentionally quiet contexts.",
    source: sourceFor("raw-grid"),
    colors: { background: "#f1e8d7", text: "#111111", accent: "#f39ab5", secondary: "#8aa889", panel: "#fffaf0" },
  }),
  makeTemplate({
    slug: "retro-windows",
    name: "Retro Windows",
    tagline: "Windows 95 chrome with gray title bars, pixel typography, and full nostalgia.",
    mood: ["nostalgic", "retro", "geeky", "playful"],
    tone: ["winking", "nostalgic", "geeky", "fun"],
    formality: "low",
    density: "medium",
    scheme: "light",
    bestFor: "Retro gaming, Y2K brands, creator portfolios with a 90s vibe, tech-history talks, and tongue-in-cheek decks.",
    avoidFor: "Modern, elegant, or institutionally credible decks.",
    source: sourceFor("retro-windows"),
    colors: { background: "#c0c0c0", text: "#000000", accent: "#000080", secondary: "#008080", panel: "#f2f2f2" },
  }),
  makeTemplate({
    slug: "retro-zine",
    name: "Retro Zine",
    tagline: "Beige paper with green accent and riso-printed DIY warmth.",
    mood: ["crafted", "lo-fi", "underground", "warm-retro"],
    tone: ["scrappy", "warm", "intentional", "DIY"],
    formality: "medium-low",
    density: "medium",
    scheme: "light",
    bestFor: "Indie zines, publications, music and arts brands, creator portfolios, small-batch launches, community decks, and underdog tech decks.",
    avoidFor: "Digital-native polish or fast modern-tech energy.",
    source: sourceFor("retro-zine"),
    colors: { background: "#efe2c2", text: "#172115", accent: "#2f7d3b", secondary: "#b8502b", panel: "#fff5dc" },
  }),
  makeTemplate({
    slug: "sakura-chroma",
    name: "Sakura Chroma",
    tagline: "Vintage Japanese cassette-package aesthetic with rainbow ribbons and condensed type.",
    mood: ["retro", "playful", "kawaii-tech", "warm", "tactile", "product-catalogue"],
    tone: ["playful", "confident", "warm", "tactile", "80s-Japanese-tech"],
    formality: "low",
    density: "medium",
    scheme: "light",
    bestFor: "Indie hardware, music-label releases, analog studio retrospectives, zines, kawaii-tech launches, and tactile printed-product decks.",
    avoidFor: "Restrained corporate or quiet typography contexts.",
    source: sourceFor("sakura-chroma"),
    colors: { background: "#fff1cf", text: "#1e1a16", accent: "#e63946", secondary: "#277da1", panel: "#fff9e8" },
  }),
  makeTemplate({
    slug: "scatterbrain",
    name: "Scatterbrain",
    tagline: "Post-it inspired: pastel sticky notes, handwriting energy, and messy-on-purpose warmth.",
    mood: ["playful", "creative", "warm", "messy-on-purpose", "workshop"],
    tone: ["informal", "warm", "expressive", "human"],
    formality: "low",
    density: "high",
    scheme: "light",
    bestFor: "Brainstorms, workshops, creative-agency credentials, design thinking, ideation pitches, and in-progress thinking.",
    avoidFor: "Precision and institutional weight.",
    source: sourceFor("scatterbrain"),
    colors: { background: "#fff7d8", text: "#2d2620", accent: "#ffcc00", secondary: "#ef7b9c", panel: "#fff3a8" },
  }),
  makeTemplate({
    slug: "signal",
    name: "Signal",
    tagline: "Deep navy canvas with bone paper and muted gold; institutional with quiet weight.",
    mood: ["institutional", "trustworthy", "considered", "weighty"],
    tone: ["sober", "polished", "established", "literary"],
    formality: "high",
    density: "high",
    scheme: "mixed",
    bestFor: "Investor decks, board presentations, consulting deliverables, legal or policy briefs, advisory pitches, and quietly authoritative tech decks.",
    avoidFor: "Hot, fast, or intentionally playful contexts.",
    source: sourceFor("signal"),
    colors: { background: "#0b1730", text: "#f5ead8", accent: "#c8a75d", secondary: "#8aa0c8", panel: "rgba(245, 234, 216, 0.1)" },
  }),
  makeTemplate({
    slug: "soft-editorial",
    name: "Soft Editorial",
    tagline: "Warm paper with sage, blush, and lemon accents; literary and unhurried.",
    mood: ["literary", "elegant", "quiet", "warm-classical"],
    tone: ["literary", "considered", "warm", "magazine"],
    formality: "high",
    density: "low",
    scheme: "light",
    bestFor: "Editorial features, longform brand stories, gallery or museum decks, advisory deliverables, lifestyle media, and founder essays.",
    avoidFor: "Decks that need visual heat or punch.",
    source: sourceFor("soft-editorial"),
    colors: { background: "#f4eedc", text: "#2a2620", accent: "#d99abb", secondary: "#d8df58", panel: "#fff9ea" },
  }),
  makeTemplate({
    slug: "stencil-tablet",
    name: "Stencil & Tablet",
    tagline: "Bone paper with stencil-cut headlines and a six-color earth palette.",
    mood: ["archival", "earthy", "tactile", "considered", "graphic"],
    tone: ["weighty", "considered", "tactile", "literary"],
    formality: "medium-high",
    density: "medium",
    scheme: "light",
    bestFor: "Museums, cultural institutions, art and architecture brands, longform research, heritage brands, craft brands, and field-manual decks.",
    avoidFor: "Digital-native polish or playful pop.",
    source: sourceFor("stencil-tablet"),
    colors: { background: "#efe3c8", text: "#31291f", accent: "#8f5d2e", secondary: "#52745f", panel: "#fff6df" },
  }),
  makeTemplate({
    slug: "studio",
    name: "Studio",
    tagline: "Black canvas with electric-yellow type; high-voltage design studio aesthetic.",
    mood: ["electric", "bold", "graphic", "design-led", "high-contrast"],
    tone: ["graphic", "loud", "modern", "intentional"],
    formality: "medium",
    density: "medium",
    scheme: "dark",
    bestFor: "Studio credentials, creative agency pitches, brand showcases, art-direction reviews, fashion, sneaker brands, and brand-statement decks.",
    avoidFor: "Quiet or institutional contexts.",
    source: sourceFor("studio"),
    colors: { background: "#050505", text: "#f5ff00", accent: "#f5ff00", secondary: "#ffffff", panel: "rgba(245, 255, 0, 0.1)" },
  }),
  makeTemplate({
    slug: "vellum",
    name: "Vellum",
    tagline: "Deep navy canvas with warm-yellow serifs and a single dusty teal accent.",
    mood: ["scholarly", "literary", "considered", "quiet", "intellectual"],
    tone: ["literary", "considered", "patient", "intelligent"],
    formality: "high",
    density: "low",
    scheme: "dark",
    bestFor: "Research synthesis, white papers, academic and policy briefs, advisory deliverables, longform editorial pieces, and founder reflections.",
    avoidFor: "Visual heat or pop.",
    source: sourceFor("vellum"),
    colors: { background: "#091a33", text: "#f4d57a", accent: "#5aa6a4", secondary: "#f3ead2", panel: "rgba(244, 213, 122, 0.1)" },
  }),
];

export const findHtmlPptBoldTemplate = (
  slug?: string | null
): HtmlPptBoldTemplate | null =>
  HTML_PPT_BOLD_TEMPLATES.find((template) => template.slug === slug) || null;

export const getHtmlPptBoldTemplate = (
  slug?: string | null
): HtmlPptBoldTemplate =>
  findHtmlPptBoldTemplate(slug) || HTML_PPT_BOLD_TEMPLATES[0];
