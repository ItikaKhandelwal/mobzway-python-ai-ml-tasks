import { AppError } from "./errors.js";

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const FALLBACK_SYSTEM_PROMPT =
  "You are Nova, a friendly and accurate AI Q&A assistant. Give clear, practical answers. Use concise formatting and say when you are uncertain.";
const LEGACY_MODEL = "gemini-2.5-flash";
const DEFAULT_MODEL = "gemini-3.5-flash";

export function getGeminiConfig() {
  const requestedModel = process.env.GEMINI_MODEL || "";
  return {
    apiKey: process.env.GEMINI_API_KEY || "",
    model: requestedModel === LEGACY_MODEL || !requestedModel ? DEFAULT_MODEL : requestedModel,
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

export async function* streamOpenAIChat({ messages, systemPrompt, signal }) {
  const config = getGeminiConfig();

  if (!config.apiKey) {
    throw new AppError("The Gemini API key is not configured on the server.", 503, "API_KEY_NOT_CONFIGURED");
  }

  const url = `${GEMINI_API_BASE_URL}/${encodeURIComponent(config.model)}:generateContent`;
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
        "x-goog-api-key": config.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt || config.defaultSystemPrompt }] },
        contents,
        generationConfig: { maxOutputTokens: 1000 },
      }),
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new AppError("Could not connect to the Gemini API. Please try again.", 502, "PROVIDER_CONNECTION_FAILED");
  }

  if (!response.ok) {
    const providerMessage = await readProviderError(response);
    console.error(`Gemini API error (${response.status}):`, providerMessage);
    const publicMessage =
      response.status === 429
        ? "Gemini is temporarily rate-limited. Please wait a moment and try again."
        : response.status === 401 || response.status === 403
          ? "The Gemini API key is invalid, restricted, or does not have access to this model."
          : response.status === 400
            ? `Gemini rejected the request: ${providerMessage}`
            : `Gemini could not process the request: ${providerMessage}`;
    throw new AppError(publicMessage, mapProviderStatus(response.status), "PROVIDER_ERROR");
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new AppError("Gemini returned an invalid response.", 502, "PROVIDER_INVALID_RESPONSE");
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((part) => typeof part?.text === "string").map((part) => part.text).join("");

  if (!text.trim()) {
    const finishReason = data?.candidates?.[0]?.finishReason;
    throw new AppError(
      finishReason ? `Gemini returned no text (finish reason: ${finishReason}). Please try again.` : "Gemini returned an empty response. Please try again.",
      502,
      "PROVIDER_EMPTY_RESPONSE",
    );
  }

  yield { type: "token", value: text };
  yield { type: "done", model: config.model, usage: data?.usageMetadata || null };
}
