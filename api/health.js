import { getOpenAIConfig } from "../lib/openai-service.js";

export default function handler() {
  const config = getOpenAIConfig();

  return Response.json(
    {
      ok: true,
      provider: "OpenAI",
      model: config.model,
      configured: Boolean(config.apiKey),
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
