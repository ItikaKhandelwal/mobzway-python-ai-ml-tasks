import { AppError } from "./errors.js";

const ALLOWED_ROLES = new Set(["user", "assistant"]);
const MAX_MESSAGES = 30;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_TOTAL_LENGTH = 18_000;
const MAX_SYSTEM_PROMPT_LENGTH = 1_500;

function cleanText(value) {
  return value.replaceAll("\u0000", "").trim();
}

export function validateChatPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AppError("The request body must be a JSON object.", 400, "INVALID_BODY");
  }

  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    throw new AppError("Please send at least one chat message.", 400, "EMPTY_MESSAGES");
  }

  if (payload.messages.length > MAX_MESSAGES) {
    throw new AppError(
      `Conversation is too long. Keep the latest ${MAX_MESSAGES} messages.`,
      400,
      "TOO_MANY_MESSAGES",
    );
  }

  let totalLength = 0;
  const messages = payload.messages.map((message, index) => {
    if (!message || typeof message !== "object") {
      throw new AppError(`Message ${index + 1} is invalid.`, 400, "INVALID_MESSAGE");
    }

    if (!ALLOWED_ROLES.has(message.role)) {
      throw new AppError(
        `Message ${index + 1} has an unsupported role.`,
        400,
        "INVALID_ROLE",
      );
    }

    if (typeof message.content !== "string") {
      throw new AppError(
        `Message ${index + 1} must contain text.`,
        400,
        "INVALID_CONTENT",
      );
    }

    const content = cleanText(message.content);
    if (!content) {
      throw new AppError(
        `Message ${index + 1} cannot be empty.`,
        400,
        "EMPTY_CONTENT",
      );
    }

    if (content.length > MAX_MESSAGE_LENGTH) {
      throw new AppError(
        `Each message must be ${MAX_MESSAGE_LENGTH.toLocaleString()} characters or fewer.`,
        400,
        "MESSAGE_TOO_LONG",
      );
    }

    totalLength += content.length;
    return { role: message.role, content };
  });

  if (messages.at(-1)?.role !== "user") {
    throw new AppError(
      "The final message must be from the user.",
      400,
      "LAST_MESSAGE_NOT_USER",
    );
  }

  if (totalLength > MAX_TOTAL_LENGTH) {
    throw new AppError(
      "The conversation is too large. Clear older messages and try again.",
      400,
      "CONVERSATION_TOO_LARGE",
    );
  }

  let systemPrompt = "";
  if (payload.systemPrompt !== undefined) {
    if (typeof payload.systemPrompt !== "string") {
      throw new AppError(
        "The system prompt must be text.",
        400,
        "INVALID_SYSTEM_PROMPT",
      );
    }

    systemPrompt = cleanText(payload.systemPrompt);
    if (systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
      throw new AppError(
        `The system prompt must be ${MAX_SYSTEM_PROMPT_LENGTH.toLocaleString()} characters or fewer.`,
        400,
        "SYSTEM_PROMPT_TOO_LONG",
      );
    }
  }

  return { messages, systemPrompt };
}
