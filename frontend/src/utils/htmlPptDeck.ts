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

export const createHtmlPptSlide = (index = 1): HtmlPptSlide => ({
  id: createHtmlPptId("slide"),
  title: index === 1 ? "Cover" : `Slide ${index}`,
  html:
    index === 1
      ? `<div class="hero">
  <div class="eyebrow">HTML PPT</div>
  <h1>Design the story directly in code</h1>
  <p>Use Ultra to reshape this page, then export the deck as a single HTML file.</p>
</div>`
      : `<div class="content">
  <h1>Slide ${index}</h1>
  <p>Describe the change you want, and Ultra will rewrite this page.</p>
</div>`,
  css:
    index === 1
      ? `.hero {
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
}`
      : `.content {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 20px;
}`,
});

export const createDefaultHtmlPptDeck = (): HtmlPptDeck => ({
  version: 1,
  aspectRatio: "16:9",
  themeCss: DEFAULT_THEME_CSS,
  slides: [createHtmlPptSlide(1), createHtmlPptSlide(2), createHtmlPptSlide(3)],
});
