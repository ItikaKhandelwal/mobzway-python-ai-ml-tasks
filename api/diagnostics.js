import { getGeminiConfig, runGeminiHealthCheck } from "../lib/gemini-service.js";

export default async function handler(request, response) {
  const config = getGeminiConfig();
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  if (request.method !== "GET") {
    return response.status(405).json({ ok: false, error: "Use GET for this diagnostic endpoint." });
  }

  try {
    const result = await runGeminiHealthCheck();
    return response.status(result.ok ? 200 : 502).json({
      provider: "Gemini",
      configured: Boolean(config.apiKey),
      ...result,
    });
  } catch (error) {
    console.error("Gemini diagnostic failed:", error);
    return response.status(502).json({
      ok: false,
      provider: "Gemini",
      model: config.model,
      configured: Boolean(config.apiKey),
      error: error?.message || "Could not run the Gemini diagnostic.",
    });
  }
}
