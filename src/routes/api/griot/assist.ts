import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { runLocalGriotAssist } from "@/lib/griot";

const assistBodySchema = z.object({
  action: z.enum([
    "draft_ping",
    "clarity_audit",
    "hashtag_suggest",
    "opportunity_pitch",
    "business_reply_draft",
    "thread_summary",
    "translation_prep",
  ]),
  inputText: z.string().trim().min(1).max(4000),
  tone: z.enum(["concise", "professional", "warm", "structured"]).optional(),
  targetLocale: z.string().max(12).optional(),
});

/**
 * GRIOT AI Server Assist Endpoint (Phase 5.1).
 *
 * Security & Honesty Invariants:
 * - Never accesses `private_messages`, Close Circle tables, or user sessions silently.
 * - Operates strictly on `inputText` explicitly submitted by the caller.
 * - When `GRIOT_AI_API_URL` & `GRIOT_AI_API_KEY` are provisioned server-side, proxies
 *   to the configured OpenAI-compatible chat completions provider; otherwise returns
 *   transparent `deterministic_local` results without fabricating LLM claims.
 */
export const Route = createFileRoute("/api/griot/assist")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsedBody: z.infer<typeof assistBodySchema>;
        try {
          const raw = await request.json();
          parsedBody = assistBodySchema.parse(raw);
        } catch {
          return new Response(JSON.stringify({ error: "Invalid GRIOT request payload." }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
          .process?.env;
        const apiUrl = env?.["GRIOT_AI_API_URL"];
        const apiKey = env?.["GRIOT_AI_API_KEY"];
        const model = env?.["GRIOT_AI_MODEL"] ?? "gpt-4o-mini";

        if (apiUrl && apiKey) {
          try {
            const upstream = await fetch(apiUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model,
                temperature: 0.4,
                messages: [
                  {
                    role: "system",
                    content:
                      "You are GRIOT AI, a permission-bounded writing & structuring assistant for Ping by DOT. Operate strictly on the user-supplied text. Never claim access to private messages or confidential records. Keep responses concise, helpful, and grounded.",
                  },
                  {
                    role: "user",
                    content: `Action: ${parsedBody.action}\nTone: ${parsedBody.tone ?? "concise"}\n${parsedBody.targetLocale ? `Target Locale: ${parsedBody.targetLocale}\n` : ""}Input:\n${parsedBody.inputText}`,
                  },
                ],
              }),
            });

            if (upstream.ok) {
              const json = (await upstream.json()) as {
                choices?: Array<{ message?: { content?: string } }>;
              };
              const text = json.choices?.[0]?.message?.content?.trim();
              if (text) {
                const baseline = runLocalGriotAssist({
                  action: parsedBody.action,
                  inputText: parsedBody.inputText,
                  tone: parsedBody.tone,
                  targetLocale: parsedBody.targetLocale,
                });
                return new Response(
                  JSON.stringify({
                    ...baseline,
                    providerMode: "live_provider",
                    providerNotice: `Processed via configured GRIOT server model (${model}). Only explicitly submitted text was sent.`,
                    outputText: text,
                    privateMessagesAccessed: false,
                  }),
                  { status: 200, headers: { "Content-Type": "application/json" } },
                );
              }
            }
          } catch {
            // Fall through cleanly to deterministic local mode
          }
        }

        const localResult = runLocalGriotAssist({
          action: parsedBody.action,
          inputText: parsedBody.inputText,
          tone: parsedBody.tone,
          targetLocale: parsedBody.targetLocale,
        });

        return new Response(JSON.stringify(localResult), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
