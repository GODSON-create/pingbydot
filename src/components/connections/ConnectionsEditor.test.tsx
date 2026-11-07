import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectionsEditor } from "./ConnectionsEditor";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: mocks }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
afterEach(cleanup);
beforeEach(() => {
  mocks.rpc.mockReset().mockResolvedValue({ error: null });
  mocks.from
    .mockReset()
    .mockReturnValue({ select: () => ({ eq: async () => ({ data: [], error: null }) }) });
});
function editor() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ConnectionsEditor userId="owner-id" />
    </QueryClientProvider>,
  );
}
describe("Connections editor", () => {
  it("saves only the selected platform, defaults private, and previews normalized destination", async () => {
    editor();
    const input = await screen.findByLabelText("International phone number");
    fireEvent.change(input, { target: { value: "+44 7700 900123" } });
    expect(screen.getByRole("link", { name: /Preview WhatsApp destination/ })).toHaveAttribute(
      "href",
      "https://wa.me/447700900123",
    );
    fireEvent.submit(screen.getByRole("form", { name: "WhatsApp connection" }));
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith("save_profile_connection", {
        _platform: "whatsapp",
        _handle: "447700900123",
        _is_public: false,
        _is_primary: false,
      }),
    );
  });
  it("rejects invalid input without writing and independently saves public/primary flags", async () => {
    editor();
    const input = await screen.findByLabelText("International phone number");
    fireEvent.change(input, { target: { value: "07700900123" } });
    fireEvent.submit(screen.getByRole("form", { name: "WhatsApp connection" }));
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "+44 7700 900123" } });
    fireEvent.click(screen.getByRole("switch", { name: "Make WhatsApp public" }));
    const form = screen.getByRole("form", { name: "WhatsApp connection" });
    fireEvent.click(form.querySelector('button[aria-pressed="false"]') ?? form);
    fireEvent.submit(form);
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith("save_profile_connection", {
        _platform: "whatsapp",
        _handle: "447700900123",
        _is_public: true,
        _is_primary: true,
      }),
    );
  });
  it("keeps unsaved input when saving fails", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("offline"));
    editor();
    const input = await screen.findByLabelText("International phone number");
    fireEvent.change(input, { target: { value: "+44 7700 900123" } });
    fireEvent.submit(screen.getByRole("form", { name: "WhatsApp connection" }));
    await screen.findByRole("alert");
    expect(input).toHaveValue("+44 7700 900123");
  });
});
