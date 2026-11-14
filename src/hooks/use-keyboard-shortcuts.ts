import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

export function useKeyboardShortcuts() {
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    let pendingG = false;
    let gTimeout: NodeJS.Timeout | null = null;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when user is typing in form controls
      const activeEl = document.activeElement;
      const isInput =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl?.getAttribute("contenteditable") === "true";

      if (isInput) return;

      // Check key
      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setHelpOpen((prev) => !prev);
        return;
      }

      if (e.key === "Escape") {
        setHelpOpen(false);
        return;
      }

      if (
        (e.key === "c" || e.key === "n" || e.key === "C" || e.key === "N") &&
        !e.metaKey &&
        !e.ctrlKey
      ) {
        e.preventDefault();
        navigate({ to: "/create" });
        return;
      }

      if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        navigate({ to: "/explore" });
        return;
      }

      // 'g' key sequence handler (e.g. g + h for home, g + m for messages)
      if (e.key === "g" || e.key === "G") {
        pendingG = true;
        if (gTimeout) clearTimeout(gTimeout);
        gTimeout = setTimeout(() => {
          pendingG = false;
        }, 1000);
        return;
      }

      if (pendingG) {
        pendingG = false;
        if (gTimeout) clearTimeout(gTimeout);

        if (e.key === "h" || e.key === "H") {
          e.preventDefault();
          navigate({ to: "/" });
        } else if (e.key === "m" || e.key === "M") {
          e.preventDefault();
          navigate({ to: "/messages" });
        } else if (e.key === "s" || e.key === "S") {
          e.preventDefault();
          navigate({ to: "/signals" });
        } else if (e.key === "b" || e.key === "B") {
          e.preventDefault();
          navigate({ to: "/hubs" });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (gTimeout) clearTimeout(gTimeout);
    };
  }, [navigate]);

  return { helpOpen, setHelpOpen };
}
