import { getGeminiConfig } from "../lib/gemini-service.js";

export default async function handler(request, response) {
  const config = getGeminiConfig();
  response.setHeader("Cache-Control", "no-store");

  if (!config.apiKey) {
    return response.status(503).json({ ok: false, provider: "Gemini", model: config.model, configured: false, error: "GEMINI_API_KEY is not configured in the deployment." });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;
  try {
    const geminiResponse = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey }, body: JSON.stringify({ contents: [{ parts: [{ text: "Reply with exactly: GEMINI_OK" }] }], generationConfig: { maxOutputTokens: 20 } }) });
    const data = await geminiResponse.json().catch(() => null);
    const text = data?.candidates?.[0]?.content?.parts?.map((part) => part?.text || "").join("") || "";
    if (!geminiResponse.ok) return response.status(502).json({ ok: false, provider: "Gemini", model: config.model, configured: true, geminiStatus: geminiResponse.status, error: data?.error?.message || "Gemini rejected the diagnostic request." });
    return response.status(200).json({ ok: text.trim() === "GEMINI_OK", provider: "Gemini", model: config.model, configured: true, geminiStatus: geminiResponse.status, responseReceived: Boolean(text), text });
  } catch (error) {
    return response.status(502).json({ ok: false, provider: "Gemini", model: config.model, configured: true, error: error?.message || "Could not connect to Gemini." });
  }
}
