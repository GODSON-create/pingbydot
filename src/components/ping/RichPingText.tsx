import { Link } from "@tanstack/react-router";
import { tokenizeRichText } from "@/lib/social";

export function RichPingText({
  text,
  interactive = true,
}: {
  text: string;
  interactive?: boolean;
}) {
  const tokens = tokenizeRichText(text);
  if (!interactive) {
    return <>{text}</>;
  }

  return (
    <>
      {tokens.map((tok, idx) => {
        if (tok.type === "mention") {
          return (
            <Link
              key={idx}
              to="/@{$username}"
              params={{ username: tok.username }}
              onClick={(e) => e.stopPropagation()}
              className="relative z-20 font-semibold text-primary hover:underline"
            >
              {tok.value}
            </Link>
          );
        }
        if (tok.type === "dot_tag") {
          return (
            <Link
              key={idx}
              to="/tag/$slug"
              params={{ slug: tok.tag }}
              onClick={(e) => e.stopPropagation()}
              className="relative z-20 inline-flex items-baseline font-semibold text-primary hover:underline"
            >
              {tok.value}
            </Link>
          );
        }
        if (tok.type === "hashtag") {
          return (
            <Link
              key={idx}
              to="/tag/$slug"
              params={{ slug: tok.tag }}
              onClick={(e) => e.stopPropagation()}
              className="relative z-20 font-semibold text-primary/85 hover:underline"
            >
              {tok.value}
            </Link>
          );
        }
        return <span key={idx}>{tok.value}</span>;
      })}
    </>
  );
}
