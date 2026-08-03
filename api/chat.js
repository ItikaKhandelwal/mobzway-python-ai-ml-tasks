import { AppError, toPublicError } from "../lib/errors.js";
import { getOpenAIConfig, streamOpenAIChat } from "../lib/openai-service.js";
import { validateChatPayload } from "../lib/validation.js";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const rateLimitStore = globalThis.__levelOneChatRateLimit || new Map();
globalThis.__levelOneChatRateLimit = rateLimitStore;

function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...extraHeaders },
  });
}

function getClientId(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "anonymous";
}

function enforceRateLimit(request) {
  const now = Date.now();
  const clientId = getClientId(request);
  const existing = rateLimitStore.get(clientId);

  if (!existing || now - existing.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(clientId, { windowStartedAt: now, count: 1 });
    return;
  }

  existing.count += 1;
  if (existing.count > RATE_LIMIT_MAX_REQUESTS) {
    throw new AppError(
      "Too many requests. Please wait briefly and try again.",
      429,
      "RATE_LIMITED",
    );
  }

  if (rateLimitStore.size > 500) {
    for (const [key, value] of rateLimitStore) {
      if (now - value.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
        rateLimitStore.delete(key);
      }
    }
  }
}

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { Allow: "POST, OPTIONS" },
    });
  }

  if (request.method !== "POST") {
    return json(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for this endpoint." } },
      405,
      { Allow: "POST, OPTIONS" },
    );
  }

  try {
    enforceRateLimit(request);

    const config = getOpenAIConfig();
    if (!config.apiKey) {
      throw new AppError(
        "The OpenAI API key is not configured. Add OPENAI_API_KEY in Vercel and redeploy.",
        503,
        "API_KEY_NOT_CONFIGURED",
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      throw new AppError("The request body must be valid JSON.", 400, "INVALID_JSON");
    }

    const { messages, systemPrompt } = validateChatPayload(body);
    const encoder = new TextEncoder();

    const responseStream = new ReadableStream({
      async start(controller) {
        const send = (event) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };

        try {
          send({ type: "meta", provider: "OpenAI", model: config.model });

          for await (const event of streamOpenAIChat({
            messages,
            systemPrompt,
            signal: request.signal,
          })) {
            send(event);
          }
        } catch (error) {
          if (error?.name !== "AbortError") {
            const publicError = toPublicError(error);
            send({
              type: "error",
              code: publicError.code,
              message: publicError.message,
            });
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(responseStream, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    const publicError = toPublicError(error);
    return json(
      { error: { code: publicError.code, message: publicError.message } },
      publicError.status,
      publicError.status === 429 ? { "Retry-After": "60" } : {},
    );
  }
}
