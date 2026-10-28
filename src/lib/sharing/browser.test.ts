import { afterEach, describe, expect, it, vi } from "vitest";
import { createCardPng } from "./browser";

vi.mock("./render", () => ({ renderCardSvg: vi.fn().mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"/>') }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PNG failure cleanup", () => {
  it("clears the image timeout and releases the object URL after decode fails", async () => {
    vi.useFakeTimers();
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:card"), revokeObjectURL: revoke });
    vi.stubGlobal("Image", class { decode() { return Promise.reject(new Error("Decode failed")); } });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(), fillRect: vi.fn(), getImageData: () => ({ data: [255, 249, 239, 255] }),
    } as unknown as CanvasRenderingContext2D);
    await expect(createCardPng({ id: "f173a470-fef1-412c-bbfb-30d444b828a1", content: "A launch", category: "launch", author: null, image_url: null, updated_at: "2026-10-25T00:00:00Z" })).rejects.toThrow("Decode failed");
    expect(vi.getTimerCount()).toBe(0);
    expect(revoke).toHaveBeenCalledWith("blob:card");
  });
});