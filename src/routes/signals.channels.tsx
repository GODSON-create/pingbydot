import { createFileRoute } from "@tanstack/react-router";
import { InboxSectionTabs } from "@/components/inbox/InboxSectionTabs";
import { SignalsDirectorySection } from "@/routes/signals";
import { pageHead } from "@/lib/site";

export const Route = createFileRoute("/signals/channels")({
  staticData: { sitemap: true },
  head: () =>
    pageHead({
      title: "Signals — Institutional Broadcast Channels on PING",
      description:
        "Browse verified institutional broadcast channels, universities, companies, incubators, and organizations on PING.",
      path: "/signals/channels",
    }),
  component: SignalChannelsDirectory,
});

function SignalChannelsDirectory() {
  return (
    <div className="mx-auto max-w-6xl w-full min-w-0 px-4 sm:px-6 pt-4 pb-32 sm:pb-24 space-y-5 overflow-x-clip">
      <InboxSectionTabs activeSection="signals" />
      <SignalsDirectorySection embeddedInInbox />
    </div>
  );
}
