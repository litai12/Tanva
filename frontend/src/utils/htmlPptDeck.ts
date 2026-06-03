export type HtmlPptSlide = {
  id: string;
  title: string;
  html: string;
  css: string;
  notes?: string;
};

export type HtmlPptDeck = {
  version: 1;
  aspectRatio: "16:9" | "4:3";
  themeCss: string;
  slides: HtmlPptSlide[];
};

export type HtmlPptSlideTemplateKey =
  | "cover"
  | "content"
  | "agenda"
  | "compare"
  | "metrics"
  | "closing";

export const HTML_PPT_SLIDE_TEMPLATE_OPTIONS: Array<{
  key: HtmlPptSlideTemplateKey;
  label: string;
  description: string;
}> = [
  { key: "cover", label: "Cover", description: "Title and short positioning." },
  { key: "content", label: "Content", description: "Single message with detail copy." },
  { key: "agenda", label: "Agenda", description: "Three to four sections." },
  { key: "compare", label: "Compare", description: "Two-column contrast." },
  { key: "metrics", label: "Metrics", description: "KPI cards and takeaway." },
  { key: "closing", label: "Closing", description: "Final statement and next step." },
];

const DEFAULT_THEME_CSS = `
.slide-root {
  padding: 64px;
  background: linear-gradient(135deg, #f8fafc 0%, #ffffff 45%, #eef2ff 100%);
  color: #111827;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.slide-root h1 {
  margin: 0;
  font-size: 58px;
  line-height: 1.02;
  font-weight: 760;
  letter-spacing: 0;
}
.slide-root p {
  margin: 0;
  font-size: 22px;
  line-height: 1.45;
  color: #475569;
}
`.trim();

export const createHtmlPptId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const createCoverSlide = (): Pick<HtmlPptSlide, "title" | "html" | "css"> => ({
  title: "Cover",
  html: `<div class="hero">
  <div class="eyebrow">HTML PPT</div>
  <h1>Design the story directly in code</h1>
  <p>Use Ultra to reshape this page, then export the deck as a single HTML file.</p>
</div>`,
  css: `.hero {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 24px;
}
.eyebrow {
  width: fit-content;
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  padding: 8px 14px;
  color: #0f766e;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}`,
});

const createContentSlide = (index: number): Pick<HtmlPptSlide, "title" | "html" | "css"> => ({
  title: `Slide ${index}`,
  html: `<div class="content">
  <h1>Slide ${index}</h1>
  <p>Describe the change you want, and Ultra will rewrite this page.</p>
</div>`,
  css: `.content {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 20px;
}`,
});

const createAgendaSlide = (): Pick<HtmlPptSlide, "title" | "html" | "css"> => ({
  title: "Agenda",
  html: `<div class="agenda">
  <p class="kicker">Agenda</p>
  <h1>Three moves for the story</h1>
  <div class="agenda-list">
    <div><span>01</span><strong>Context</strong><p>Why this matters now.</p></div>
    <div><span>02</span><strong>Direction</strong><p>The design and product choice.</p></div>
    <div><span>03</span><strong>Next step</strong><p>What the audience should do.</p></div>
  </div>
</div>`,
  css: `.agenda {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 28px;
}
.kicker {
  color: #0f766e;
  font-size: 14px;
  font-weight: 800;
  text-transform: uppercase;
}
.agenda-list {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
}
.agenda-list div {
  padding: 22px;
  border: 1px solid #dbe3ef;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.72);
}
.agenda-list span {
  display: block;
  margin-bottom: 22px;
  color: #2563eb;
  font-weight: 800;
}`,
});

const createCompareSlide = (): Pick<HtmlPptSlide, "title" | "html" | "css"> => ({
  title: "Comparison",
  html: `<div class="compare">
  <h1>Before and after</h1>
  <div class="columns">
    <div>
      <p class="label">Before</p>
      <h2>Manual slide polishing</h2>
      <p>Visual changes require copying context between tools.</p>
    </div>
    <div>
      <p class="label">After</p>
      <h2>Conversation-driven HTML pages</h2>
      <p>Each page can be reshaped in place and exported immediately.</p>
    </div>
  </div>
</div>`,
  css: `.compare {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 34px;
}
.columns {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
}
.columns > div {
  min-height: 260px;
  padding: 28px;
  border-radius: 22px;
  border: 1px solid #dbe3ef;
  background: rgba(255, 255, 255, 0.78);
}
.label {
  margin-bottom: 28px;
  color: #2563eb;
  font-size: 14px;
  font-weight: 800;
  text-transform: uppercase;
}
.columns h2 {
  margin: 0 0 18px;
  font-size: 32px;
  line-height: 1.08;
}`,
});

const createMetricsSlide = (): Pick<HtmlPptSlide, "title" | "html" | "css"> => ({
  title: "Metrics",
  html: `<div class="metrics">
  <div>
    <p class="kicker">Signal</p>
    <h1>Measure the story by outcomes</h1>
  </div>
  <div class="metric-grid">
    <div><strong>3x</strong><span>Faster first draft</span></div>
    <div><strong>24</strong><span>Slides per deck limit</span></div>
    <div><strong>0</strong><span>Inline assets persisted</span></div>
  </div>
</div>`,
  css: `.metrics {
  height: 100%;
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  align-items: center;
  gap: 42px;
}
.kicker {
  color: #0f766e;
  font-size: 14px;
  font-weight: 800;
  text-transform: uppercase;
}
.metric-grid {
  display: grid;
  gap: 16px;
}
.metric-grid div {
  padding: 24px 26px;
  border-radius: 20px;
  border: 1px solid #dbe3ef;
  background: rgba(255, 255, 255, 0.8);
}
.metric-grid strong {
  display: block;
  color: #111827;
  font-size: 50px;
  line-height: 1;
}
.metric-grid span {
  display: block;
  margin-top: 10px;
  color: #64748b;
  font-size: 17px;
}`,
});

const createClosingSlide = (): Pick<HtmlPptSlide, "title" | "html" | "css"> => ({
  title: "Closing",
  html: `<div class="closing">
  <p class="kicker">Next</p>
  <h1>Turn the conversation into a presentation workflow.</h1>
  <p>Connect prompts, assets, and generated pages without leaving the canvas.</p>
</div>`,
  css: `.closing {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 24px;
}
.kicker {
  color: #0f766e;
  font-size: 14px;
  font-weight: 800;
  text-transform: uppercase;
}
.closing h1 {
  max-width: 880px;
}`,
});

const getTemplateContent = (
  index: number,
  template: HtmlPptSlideTemplateKey
): Pick<HtmlPptSlide, "title" | "html" | "css"> => {
  switch (template) {
    case "cover":
      return createCoverSlide();
    case "agenda":
      return createAgendaSlide();
    case "compare":
      return createCompareSlide();
    case "metrics":
      return createMetricsSlide();
    case "closing":
      return createClosingSlide();
    case "content":
    default:
      return createContentSlide(index);
  }
};

export const createHtmlPptSlide = (
  index = 1,
  template: HtmlPptSlideTemplateKey = index === 1 ? "cover" : "content"
): HtmlPptSlide => ({
  id: createHtmlPptId("slide"),
  ...getTemplateContent(index, template),
});

export const createDefaultHtmlPptDeck = (): HtmlPptDeck => ({
  version: 1,
  aspectRatio: "16:9",
  themeCss: DEFAULT_THEME_CSS,
  slides: [createHtmlPptSlide(1), createHtmlPptSlide(2), createHtmlPptSlide(3)],
});
