import { AppError, toPublicError } from "../lib/errors.js";
import { getOpenAIConfig, streamOpenAIChat } from "../lib/openai-service.js";
import { validateChatPayload } from "../lib/validation.js";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const rateLimitStore = globalThis.__levelOneChatRateLimit || new Map();
globalThis.__levelOneChatRateLimit = rateLimitStore;

function sendJson(response, data, status = 200, extraHeaders = {}) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  for (const [key, value] of Object.entries(extraHeaders)) {
    response.setHeader(key, value);
  }
  response.end(JSON.stringify(data));
}

function getClientId(request) {
  const forwarded = request.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return value?.split(",")[0]?.trim() || "anonymous";
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

async function readJsonBody(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
    return request.body;
  }

  if (typeof request.body === "string") {
    return JSON.parse(request.body);
  }

  if (Buffer.isBuffer(request.body)) {
    return JSON.parse(request.body.toString("utf8"));
  }

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw || "{}");
}

export default async function handler(request, response) {
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.setHeader("Allow", "POST, OPTIONS");
    return response.end();
  }

  if (request.method !== "POST") {
    return sendJson(
      response,
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
        "The Gemini API key is not configured. Add GEMINI_API_KEY in Vercel and redeploy.",
        503,
        "API_KEY_NOT_CONFIGURED",
      );
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch {
      throw new AppError("The request body must be valid JSON.", 400, "INVALID_JSON");
    }

    const { messages, systemPrompt } = validateChatPayload(body);

    response.statusCode = 200;
    response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders?.();

    const send = (event) => response.write(`${JSON.stringify(event)}\n`);

    try {
      send({ type: "meta", provider: "Gemini", model: config.model });

      for await (const event of streamOpenAIChat({
        messages,
        systemPrompt,
        signal: undefined,
      })) {
        send(event);
      }
    } catch (error) {
      const publicError = toPublicError(error);
      send({ type: "error", code: publicError.code, message: publicError.message });
    } finally {
      response.end();
    }
  } catch (error) {
    const publicError = toPublicError(error);
    return sendJson(
      response,
      { error: { code: publicError.code, message: publicError.message } },
      publicError.status,
      publicError.status === 429 ? { "Retry-After": "60" } : {},
    );
  }
}
