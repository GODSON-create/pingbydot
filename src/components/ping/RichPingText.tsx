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
        if (tok.type === "hashtag") {
          return (
            <Link
              key={idx}
              to="/explore"
              search={{ q: `#${tok.tag}` }}
              onClick={(e) => e.stopPropagation()}
              className="relative z-20 font-semibold text-primary/90 hover:underline"
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
