import { AppError } from "./errors.js";
import { parseSSE } from "./sse.js";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const FALLBACK_SYSTEM_PROMPT =
  "You are Nova, a friendly and accurate AI Q&A assistant. Give clear, practical answers. Use concise formatting and say when you are uncertain.";

export function getOpenAIConfig() {
  return {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-5-mini",
    defaultSystemPrompt:
      process.env.DEFAULT_SYSTEM_PROMPT || FALLBACK_SYSTEM_PROMPT,
  };
}

async function readProviderError(response) {
  try {
    const data = await response.json();
    return data?.error?.message || data?.message || "The AI provider rejected the request.";
  } catch {
    return "The AI provider rejected the request.";
  }
}

function mapProviderStatus(status) {
  if (status === 401 || status === 403) return 502;
  if (status === 429) return 429;
  if (status >= 400 && status < 500) return 400;
  return 502;
}

/**
 * Streams token events from OpenAI's Chat Completions API.
 * The API key stays on the server and is never sent to the browser.
 */
export async function* streamOpenAIChat({ messages, systemPrompt, signal }) {
  const config = getOpenAIConfig();

  if (!config.apiKey) {
    throw new AppError(
      "The OpenAI API key is not configured on the server.",
      503,
      "API_KEY_NOT_CONFIGURED",
    );
  }

  const resolvedSystemPrompt = systemPrompt || config.defaultSystemPrompt;

  let response;
  try {
    response = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: resolvedSystemPrompt },
          ...messages,
        ],
        stream: true,
        stream_options: { include_usage: true },
        max_completion_tokens: 1_000,
      }),
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new AppError(
      "Could not connect to the OpenAI API. Please try again.",
      502,
      "PROVIDER_CONNECTION_FAILED",
    );
  }

  if (!response.ok) {
    const providerMessage = await readProviderError(response);
    console.error(`OpenAI API error (${response.status}):`, providerMessage);

    const publicMessage =
      response.status === 429
        ? "The AI service is temporarily rate-limited. Please wait a moment and try again."
        : response.status === 401 || response.status === 403
          ? "The server's OpenAI API key is invalid or does not have access to this model."
          : "The AI service could not process the request. Please try again.";

    throw new AppError(
      publicMessage,
      mapProviderStatus(response.status),
      "PROVIDER_ERROR",
    );
  }

  let usage = null;

  for await (const data of parseSSE(response.body)) {
    if (data === "[DONE]") break;

    let event;
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }

    if (event.error) {
      throw new AppError(
        "The AI service stopped unexpectedly. Please try again.",
        502,
        "PROVIDER_STREAM_ERROR",
      );
    }

    const token = event.choices?.[0]?.delta?.content;
    if (typeof token === "string" && token.length > 0) {
      yield { type: "token", value: token };
    }

    if (event.usage) usage = event.usage;
  }

  yield { type: "done", model: config.model, usage };
}
