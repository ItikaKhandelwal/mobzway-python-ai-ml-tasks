import { AppError } from "./errors.js";

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const FALLBACK_SYSTEM_PROMPT =
  "You are Nova, a friendly and accurate AI Q&A assistant. Give clear, practical answers. Use concise formatting and say when you are uncertain.";
const LEGACY_MODEL = "gemini-2.5-flash";
const DEFAULT_MODEL = "gemini-3.5-flash";
const FALLBACK_MODEL = "gemini-3.5-flash-lite";
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 900;

export function getGeminiConfig() {
  const requestedModel = process.env.GEMINI_MODEL || "";
  return {
    apiKey: process.env.GEMINI_API_KEY || "",
    model: requestedModel === LEGACY_MODEL || !requestedModel ? DEFAULT_MODEL : requestedModel,
    fallbackModel: FALLBACK_MODEL,
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

function isTransientStatus(status) {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function retryDelay(attempt) {
  const jitter = Math.floor(Math.random() * 350);
  return BASE_RETRY_DELAY_MS * 2 ** attempt + jitter;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    const abort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("Request aborted"), { name: "AbortError" }));
    };
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function requestGemini({ model, apiKey, systemPrompt, contents, signal }) {
  const url = `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent`;
  let lastStatus = 502;
  let lastMessage = "The Gemini API rejected the request.";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: { maxOutputTokens: 1000 },
        }),
        signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      if (attempt < MAX_RETRIES) {
        await sleep(retryDelay(attempt), signal);
        continue;
      }
      throw new AppError(
        "Could not connect to Gemini. Please check your connection and try again.",
        502,
        "PROVIDER_CONNECTION_FAILED",
      );
    }

    if (response.ok) return { response, model };

    lastStatus = response.status;
    lastMessage = await readProviderError(response);
    console.error(`Gemini API error (${response.status}) on ${model}, attempt ${attempt + 1}:`, lastMessage);

    if (!isTransientStatus(response.status) || attempt >= MAX_RETRIES) break;
    await sleep(retryDelay(attempt), signal);
  }

  return { error: { status: lastStatus, message: lastMessage }, model };
}

function throwProviderError(status, providerMessage) {
  const publicMessage =
    status === 429
      ? "Gemini is temporarily rate-limited. Please try again in a moment."
      : status === 401 || status === 403
        ? "The Gemini API key is invalid, restricted, or does not have access to this model."
        : status === 503
          ? "Gemini is temporarily busy. We retried automatically; please try again in a few seconds."
          : status === 400
            ? `Gemini rejected the request: ${providerMessage}`
            : `Gemini could not process the request: ${providerMessage}`;

  throw new AppError(publicMessage, status === 429 ? 429 : 502, "PROVIDER_ERROR");
}

async function generateWithResilience({ config, systemPrompt, contents, signal }) {
  let result = await requestGemini({
    model: config.model,
    apiKey: config.apiKey,
    systemPrompt,
    contents,
    signal,
  });

  let actualModel = config.model;

  if (result.error?.status === 503 && config.fallbackModel !== config.model) {
    console.warn(`Gemini ${config.model} remained unavailable; trying ${config.fallbackModel}.`);
    result = await requestGemini({
      model: config.fallbackModel,
      apiKey: config.apiKey,
      systemPrompt,
      contents,
      signal,
    });
    actualModel = config.fallbackModel;
  }

  return { result, actualModel };
}

export async function runGeminiHealthCheck() {
  const config = getGeminiConfig();
  if (!config.apiKey) return { ok: false, model: config.model, configured: false, error: "GEMINI_API_KEY is not configured." };

  const { result, actualModel } = await generateWithResilience({
    config,
    systemPrompt: "Reply with exactly: GEMINI_OK",
    contents: [{ role: "user", parts: [{ text: "Health check" }] }],
  });

  if (result.error) {
    return {
      ok: false,
      model: actualModel,
      configured: true,
      geminiStatus: result.error.status,
      error: result.error.message,
      fallbackAttempted: actualModel !== config.model,
    };
  }

  const data = await result.response.json().catch(() => null);
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part?.text || "").join("") || "";
  return {
    ok: text.trim() === "GEMINI_OK",
    model: actualModel,
    configured: true,
    geminiStatus: result.response.status,
    responseReceived: Boolean(text),
    text,
    fallbackUsed: actualModel !== config.model,
  };
}

export async function* streamOpenAIChat({ messages, systemPrompt, signal }) {
  const config = getGeminiConfig();

  if (!config.apiKey) {
    throw new AppError(
      "The Gemini API key is not configured on the server.",
      503,
      "API_KEY_NOT_CONFIGURED",
    );
  }

  const contents = messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));

  const { result, actualModel } = await generateWithResilience({
    config,
    systemPrompt: systemPrompt || config.defaultSystemPrompt,
    contents,
    signal,
  });

  if (result.error) {
    throwProviderError(result.error.status, result.error.message);
  }

  let data;
  try {
    data = await result.response.json();
  } catch {
    throw new AppError(
      "Gemini returned an invalid response. Please try again.",
      502,
      "PROVIDER_INVALID_RESPONSE",
    );
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .filter((part) => typeof part?.text === "string")
    .map((part) => part.text)
    .join("");

  if (!text.trim()) {
    const finishReason = data?.candidates?.[0]?.finishReason;
    throw new AppError(
      finishReason
        ? `Gemini returned no text (finish reason: ${finishReason}). Please try again.`
        : "Gemini returned an empty response. Please try again.",
      502,
      "PROVIDER_EMPTY_RESPONSE",
    );
  }

  yield { type: "token", value: text };
  yield {
    type: "done",
    model: actualModel,
    usage: data?.usageMetadata || null,
    fallbackUsed: actualModel !== config.model,
  };
}
