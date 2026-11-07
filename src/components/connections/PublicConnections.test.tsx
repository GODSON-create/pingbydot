import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PublicConnections } from "./PublicConnections";
import type { Connection } from "@/lib/connections";

afterEach(cleanup);
describe("Public connections", () => {
  const rows: Connection[] = [
    { platform: "whatsapp", handle: "447700900123", is_public: false, is_primary: true },
    { platform: "snapchat", handle: "founder", is_public: true, is_primary: false },
    { platform: "instagram", handle: "founder", is_public: true, is_primary: false },
    { platform: "x", handle: "founder", is_public: true, is_primary: false },
  ];
  it("never renders a private phone number or destination", () => {
    const { container } = render(<PublicConnections connections={rows} />);
    expect(screen.queryByRole("link", { name: /WhatsApp/i })).toBeNull();
    expect(container.textContent).not.toContain("447700900123");
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });
  it("renders every public destination without dropping non-primary links", () => {
    render(<PublicConnections connections={[{ ...rows[0], platform: "whatsapp", handle: "447700900123", is_public: true, is_primary: true }, ...rows.slice(1)]} />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["https://wa.me/447700900123", "https://www.snapchat.com/add/founder", "https://www.instagram.com/founder/", "https://x.com/founder"]);
    for (const link of links) { expect(link).toHaveAttribute("target", "_blank"); expect(link).toHaveAttribute("rel", "noopener noreferrer"); }
  });
});