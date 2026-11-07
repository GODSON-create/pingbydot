import { siWhatsapp, siSnapchat, siInstagram, siX } from "simple-icons";
import type { Platform } from "@/lib/connections";

const icons = { whatsapp: siWhatsapp, snapchat: siSnapchat, instagram: siInstagram, x: siX };

export function PlatformIcon({ platform }: { platform: Platform }) {
  return <svg viewBox="0 0 24 24" className="size-5 shrink-0 fill-current" aria-hidden="true"><path d={icons[platform].path} /></svg>;
}