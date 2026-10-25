import { describe, expect, it } from "vitest";
import { cardTree, shareExcerpt, shareMessage, socialImageUrl, type SharePing } from "./card";
import { renderCardSvg } from "./render";

const ping: SharePing = { id: "f173a470-fef1-412c-bbfb-30d444b828a1", content: "Our first launch is live!", category: "launch", author: null, image_url: null, updated_at: "2026-10-25T00:00:00Z" };
const colors = { paper: "#fff9ef", ink: "#182822", forest: "#173c32", lime: "#c7f36b", muted: "#63736a", border: "#dce3d3" };
describe("Rich sharing", () => {
  it("preserves the verified public Ping URL in WhatsApp and social links", () => {
    expect(shareMessage(ping)).toContain(`https://pingbydot.lovable.app/p/${ping.id}`);
    expect(socialImageUrl(ping)).toBe(`https://pingbydot.lovable.app/api/public/ping-card/${ping.id}?v=2026-10-25T00%3A00%3A00Z`);
  });
  it("uses a concise excerpt without changing full card content", () => {
    const content = "Shipping something useful. ".repeat(70);
    expect(shareExcerpt(content).length).toBeLessThanOrEqual(160);
    expect(shareExcerpt(content).endsWith("…")).toBe(true);
    const tree = cardTree({ ...ping, content }, colors);
    expect(JSON.stringify(tree)).toContain(content);
  });
  it("renders short, maximum-length, unbroken and missing-author cards without clipping", async () => {
    for (const content of [ping.content, "word ".repeat(400), "W".repeat(2000), "First line\n\nSecond line <script> & quote"] ) {
      const svg = await renderCardSvg({ ...ping, content }, colors);
      const height = Number(svg.match(/height="(\d+)"/)?.[1]);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(height).toBeGreaterThanOrEqual(1080);
      if (content.length === 2000) expect(height).toBeGreaterThan(1080);
      expect(svg).not.toContain("<script>");
    }
  }, 20000);
  it("includes optional media without cropping its aspect ratio", async () => {
    const src = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="200"><rect width="100" height="200" fill="red"/></svg>');
    const svg = await renderCardSvg(ping, colors, { src, width: 100, height: 200 });
    expect(svg).toContain("<image");
    expect(svg).toContain("preserveAspectRatio");
  });
});