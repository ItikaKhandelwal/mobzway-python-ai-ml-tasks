import { getOpenAIConfig } from "../lib/openai-service.js";

export default function handler(request, response) {
  const config = getOpenAIConfig();

  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json({
    ok: true,
    provider: "OpenAI",
    model: config.model,
    configured: Boolean(config.apiKey),
    timestamp: new Date().toISOString(),
  });
}
