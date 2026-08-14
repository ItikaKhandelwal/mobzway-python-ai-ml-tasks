import { AppError } from "./errors.js";
import { parseSSE } from "./sse.js";

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const FALLBACK_SYSTEM_PROMPT =
  "You are Nova, a friendly and accurate AI Q&A assistant. Give clear, practical answers. Use concise formatting and say when you are uncertain.";

export function getOpenAIConfig() {
  return {
    apiKey: process.env.GEMINI_API_KEY || "",
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    defaultSystemPrompt:
      process.env.DEFAULT_SYSTEM_PROMPT || FALLBACK_SYSTEM_PROMPT,
  };
}

async function readProviderError(response) {
  try {
    const data = await response.json();
    return data?.error?.message || data?.message || "The Gemini API rejected the request.";
  } catch {
    return "The Gemini API rejected the request.";
  }
}

function mapProviderStatus(status) {
  if (status === 400) return 400;
  if (status === 401 || status === 403) return 502;
  if (status === 429) return 429;
  if (status >= 400 && status < 500) return 400;
  return 502;
}

/**
 * Streams token events from Google's Gemini API.
 * The API key stays on the server and is never sent to the browser.
 */
export async function* streamOpenAIChat({ messages, systemPrompt, signal }) {
  const config = getOpenAIConfig();

  if (!config.apiKey) {
    throw new AppError(
      "The Gemini API key is not configured on the server.",
      503,
      "API_KEY_NOT_CONFIGURED",
    );
  }

  const resolvedSystemPrompt = systemPrompt || config.defaultSystemPrompt;
  const url = `${GEMINI_API_BASE_URL}/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(config.apiKey)}`;

  const contents = messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: resolvedSystemPrompt }],
        },
        contents,
        generationConfig: {
          maxOutputTokens: 1000,
        },
      }),
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new AppError(
      "Could not connect to the Gemini API. Please try again.",
      502,
      "PROVIDER_CONNECTION_FAILED",
    );
  }

  if (!response.ok) {
    const providerMessage = await readProviderError(response);
    console.error(`Gemini API error (${response.status}):`, providerMessage);

    const publicMessage =
      response.status === 429
        ? "The AI service is temporarily rate-limited. Please wait a moment and try again."
        : response.status === 401 || response.status === 403
          ? "The server's Gemini API key is invalid or does not have access to this model."
          : "The Gemini AI service could not process the request. Please try again.";

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
        "The Gemini AI service stopped unexpectedly. Please try again.",
        502,
        "PROVIDER_STREAM_ERROR",
      );
    }

    const parts = event.candidates?.[0]?.content?.parts || [];
    const token = parts
      .filter((part) => typeof part?.text === "string")
      .map((part) => part.text)
      .join("");

    if (token) {
      yield { type: "token", value: token };
    }

    if (event.usageMetadata) usage = event.usageMetadata;
  }

  yield { type: "done", model: config.model, usage };
}
