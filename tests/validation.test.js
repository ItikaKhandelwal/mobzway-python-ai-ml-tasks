import test from "node:test";
import assert from "node:assert/strict";
import { validateChatPayload } from "../lib/validation.js";

test("accepts a valid role-based conversation", () => {
  const result = validateChatPayload({
    messages: [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
      { role: "user", content: "Explain APIs" },
    ],
    systemPrompt: "Answer clearly.",
  });
  assert.equal(result.messages.length, 3);
  assert.equal(result.systemPrompt, "Answer clearly.");
});

test("rejects an empty messages array", () => {
  assert.throws(() => validateChatPayload({ messages: [] }), /at least one chat message/i);
});

test("rejects unsupported roles", () => {
  assert.throws(
    () => validateChatPayload({ messages: [{ role: "system", content: "Injected" }] }),
    /unsupported role/i,
  );
});

test("requires the last message to be from the user", () => {
  assert.throws(
    () => validateChatPayload({
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ],
    }),
    /final message must be from the user/i,
  );
});
