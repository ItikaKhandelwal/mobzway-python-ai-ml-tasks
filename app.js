const HISTORY_KEY = "asknova-chat-history-v1";
const SETTINGS_KEY = "asknova-chat-settings-v1";
const THEME_KEY = "asknova-theme-v1";
const MAX_HISTORY_MESSAGES = 30;
const DEFAULT_SYSTEM_PROMPT =
  "You are Nova, a friendly and accurate AI Q&A assistant. Give clear, practical answers. Use concise formatting and say when you are uncertain.";

const elements = {
  messages: document.querySelector("#messages"),
  welcome: document.querySelector("#welcomeState"),
  chatForm: document.querySelector("#chatForm"),
  promptInput: document.querySelector("#promptInput"),
  sendButton: document.querySelector("#sendButton"),
  stopButton: document.querySelector("#stopButton"),
  typingRow: document.querySelector("#typingRow"),
  characterCount: document.querySelector("#characterCount"),
  statusPill: document.querySelector("#statusPill"),
  statusText: document.querySelector("#statusText"),
  configBanner: document.querySelector("#configBanner"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  systemPromptInput: document.querySelector("#systemPromptInput"),
  systemPromptCount: document.querySelector("#systemPromptCount"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  resetSettingsButton: document.querySelector("#resetSettingsButton"),
  clearButton: document.querySelector("#clearButton"),
  exportButton: document.querySelector("#exportButton"),
  themeButton: document.querySelector("#themeButton"),
  themeIcon: document.querySelector("#themeIcon"),
  toast: document.querySelector("#toast"),
};

let messages = loadJSON(HISTORY_KEY, []);
let settings = loadJSON(SETTINGS_KEY, { systemPrompt: DEFAULT_SYSTEM_PROMPT });
let activeController = null;
let isStreaming = false;
let toastTimer = null;

initialise();

function initialise() {
  applyStoredTheme();
  renderConversation();
  updateCharacterCount();
  updateSystemPromptCount();
  autoResizeTextarea();
  checkApiStatus();
  bindEvents();
}

function bindEvents() {
  elements.chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage();
  });

  elements.promptInput.addEventListener("input", () => {
    updateCharacterCount();
    autoResizeTextarea();
  });

  elements.promptInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendMessage();
    }
  });

  document.querySelectorAll(".suggestion").forEach((button) => {
    button.addEventListener("click", () => {
      elements.promptInput.value = button.dataset.prompt || "";
      updateCharacterCount();
      autoResizeTextarea();
      elements.promptInput.focus();
    });
  });

  elements.stopButton.addEventListener("click", stopGeneration);
  elements.clearButton.addEventListener("click", clearConversation);
  elements.exportButton.addEventListener("click", exportConversation);
  elements.themeButton.addEventListener("click", toggleTheme);
  elements.settingsButton.addEventListener("click", openSettings);
  elements.saveSettingsButton.addEventListener("click", saveSettings);
  elements.resetSettingsButton.addEventListener("click", resetSettings);
  elements.systemPromptInput.addEventListener("input", updateSystemPromptCount);
  window.addEventListener("online", checkApiStatus);
  window.addEventListener("offline", () => setStatus("Offline", "error"));
}

async function checkApiStatus() {
  if (!navigator.onLine) {
    setStatus("Offline", "error");
    return;
  }

  setStatus("Checking API…", "");
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) throw new Error("Health check failed");
    const data = await response.json();

    if (data.configured) {
      setStatus(`${data.model} ready`, "ready");
      elements.configBanner.hidden = true;
    } else {
      setStatus("API key missing", "error");
      elements.configBanner.hidden = false;
    }
  } catch {
    setStatus("API unavailable", "error");
  }
}

function setStatus(text, state) {
  elements.statusText.textContent = text;
  elements.statusPill.classList.remove("ready", "error");
  if (state) elements.statusPill.classList.add(state);
}

async function sendMessage() {
  const prompt = elements.promptInput.value.trim();
  if (!prompt || isStreaming) return;

  if (!navigator.onLine) {
    showToast("You appear to be offline. Reconnect and try again.");
    return;
  }

  messages.push(createStoredMessage("user", prompt));
  messages = messages.slice(-MAX_HISTORY_MESSAGES);
  persistMessages();

  elements.promptInput.value = "";
  updateCharacterCount();
  autoResizeTextarea();
  renderConversation();

  const assistantElement = appendStreamingAssistant();
  const bubble = assistantElement.querySelector(".message-bubble");
  setStreamingState(true);
  activeController = new AbortController();
  let assistantText = "";
  let completed = false;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: messages.map(({ role, content }) => ({ role, content })),
        systemPrompt: settings.systemPrompt,
      }),
      signal: activeController.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.error?.message || `The server returned status ${response.status}.`);
    }

    if (!response.body) throw new Error("The server did not return a response stream.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line) {
          const event = JSON.parse(line);
          if (event.type === "token") {
            assistantText += event.value;
            bubble.innerHTML = renderMarkdown(assistantText);
            scrollToLatest();
          } else if (event.type === "error") {
            throw new Error(event.message || "The AI stream stopped unexpectedly.");
          } else if (event.type === "done") {
            completed = true;
          }
        }
        newlineIndex = buffer.indexOf("\n");
      }

      if (done) break;
    }

    if (!assistantText.trim()) throw new Error("The AI returned an empty response. Please try again.");

    messages.push(createStoredMessage("assistant", assistantText));
    messages = messages.slice(-MAX_HISTORY_MESSAGES);
    persistMessages();
    bubble.classList.remove("streaming-caret");
    attachCopyButton(assistantElement, assistantText);

    if (!completed) showToast("The response ended before a completion event was received.");
  } catch (error) {
    if (error?.name === "AbortError") {
      if (assistantText.trim()) {
        messages.push(createStoredMessage("assistant", assistantText));
        messages = messages.slice(-MAX_HISTORY_MESSAGES);
        persistMessages();
        bubble.classList.remove("streaming-caret");
        attachCopyButton(assistantElement, assistantText);
        showToast("Generation stopped. The partial answer was saved.");
      } else {
        assistantElement.remove();
        showToast("Generation stopped.");
      }
    } else {
      assistantElement.remove();
      showToast(error?.message || "Unable to generate an answer.");
    }
  } finally {
    activeController = null;
    setStreamingState(false);
    elements.promptInput.focus();
  }
}

function stopGeneration() { activeController?.abort(); }

function setStreamingState(streaming) {
  isStreaming = streaming;
  elements.sendButton.disabled = streaming;
  elements.stopButton.hidden = !streaming;
  elements.typingRow.hidden = true;
}

function appendStreamingAssistant() {
  elements.welcome.hidden = true;
  const element = buildMessageElement(createStoredMessage("assistant", ""), { streaming: true });
  elements.messages.append(element);
  scrollToLatest();
  return element;
}

function renderConversation() {
  elements.messages.innerHTML = "";

  if (messages.length === 0) {
    elements.welcome.hidden = false;
    elements.messages.append(elements.welcome);
    return;
  }

  elements.welcome.hidden = true;
  for (const message of messages) elements.messages.append(buildMessageElement(message));
  requestAnimationFrame(scrollToLatest);
}

function buildMessageElement(message, options = {}) {
  const article = document.createElement("article");
  article.className = `message ${message.role}`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = message.role === "assistant" ? "✦" : "You";

  const content = document.createElement("div");
  content.className = "message-content";

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.innerHTML = `<strong>${message.role === "assistant" ? "Nova" : "You"}</strong><span>${formatTime(message.createdAt)}</span>`;

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";

  if (message.role === "assistant") {
    bubble.innerHTML = message.content ? renderMarkdown(message.content) : "";
    if (options.streaming) bubble.classList.add("streaming-caret");
  } else {
    bubble.textContent = message.content;
  }

  content.append(meta, bubble);
  if (message.role === "assistant" && message.content && !options.streaming) {
    attachCopyButtonToContent(content, message.content);
  }

  article.append(avatar, content);
  return article;
}

function attachCopyButton(article, text) {
  attachCopyButtonToContent(article.querySelector(".message-content"), text);
}

function attachCopyButtonToContent(content, text) {
  if (content.querySelector(".copy-button")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-button";
  button.textContent = "Copy answer";
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
      setTimeout(() => (button.textContent = "Copy answer"), 1_400);
    } catch {
      showToast("Clipboard access was blocked by the browser.");
    }
  });
  content.append(button);
}

function renderMarkdown(markdown) {
  const parts = markdown.split(/```/);
  return parts.map((part, index) => {
    if (index % 2 === 1) {
      const firstBreak = part.indexOf("\n");
      const possibleLanguage = firstBreak === -1 ? "" : part.slice(0, firstBreak).trim();
      const language = /^[a-z0-9#+.-]{1,24}$/i.test(possibleLanguage) ? possibleLanguage : "";
      const code = language ? part.slice(firstBreak + 1) : part;
      return `<pre><code${language ? ` data-language="${escapeHtml(language)}"` : ""}>${escapeHtml(code.trim())}</code></pre>`;
    }
    return renderTextBlock(part);
  }).join("");
}

function renderTextBlock(text) {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  let html = "";
  let listType = null;

  const closeList = () => {
    if (listType) {
      html += `</${listType}>`;
      listType = null;
    }
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      closeList();
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)/);
    const ordered = trimmed.match(/^\d+[.)]\s+(.+)/);

    if (unordered || ordered) {
      const nextList = unordered ? "ul" : "ol";
      if (listType !== nextList) {
        closeList();
        html += `<${nextList}>`;
        listType = nextList;
      }
      html += `<li>${renderInline(unordered?.[1] || ordered?.[1] || "")}</li>`;
      continue;
    }

    closeList();
    if (trimmed.startsWith("### ")) html += `<h4>${renderInline(trimmed.slice(4))}</h4>`;
    else if (trimmed.startsWith("## ")) html += `<h3>${renderInline(trimmed.slice(3))}</h3>`;
    else if (trimmed.startsWith("# ")) html += `<h2>${renderInline(trimmed.slice(2))}</h2>`;
    else if (trimmed.startsWith("> ")) html += `<blockquote>${renderInline(trimmed.slice(2))}</blockquote>`;
    else html += `<p>${renderInline(trimmed)}</p>`;
  }

  closeList();
  return html;
}

function renderInline(text) {
  let safe = escapeHtml(text);
  safe = safe.replace(/`([^`]+)`/g, "<code>$1</code>");
  safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  safe = safe.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  safe = safe.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return safe;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function createStoredMessage(role, content) {
  return {
    id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

function persistMessages() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(messages));
}

function clearConversation() {
  if (isStreaming) {
    showToast("Stop the current response before clearing the conversation.");
    return;
  }

  if (messages.length > 0 && !window.confirm("Clear the full conversation from this browser?")) return;
  messages = [];
  localStorage.removeItem(HISTORY_KEY);
  renderConversation();
  showToast("Conversation cleared.");
}

function exportConversation() {
  if (messages.length === 0) {
    showToast("There is no conversation to export yet.");
    return;
  }

  const transcript = [
    "# AskNova Conversation",
    "",
    `Exported: ${new Date().toLocaleString()}`,
    "",
    ...messages.flatMap((message) => [
      `## ${message.role === "assistant" ? "Nova" : "You"}`,
      "",
      message.content,
      "",
    ]),
  ].join("\n");

  const blob = new Blob([transcript], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `asknova-conversation-${new Date().toISOString().slice(0, 10)}.md`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Conversation exported as Markdown.");
}

function openSettings() {
  elements.systemPromptInput.value = settings.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  updateSystemPromptCount();
  elements.settingsDialog.showModal();
}

function saveSettings() {
  const systemPrompt = elements.systemPromptInput.value.trim();
  if (!systemPrompt) {
    showToast("The system prompt cannot be empty.");
    return;
  }

  settings = { systemPrompt };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  elements.settingsDialog.close();
  showToast("Assistant settings saved.");
}

function resetSettings() {
  elements.systemPromptInput.value = DEFAULT_SYSTEM_PROMPT;
  updateSystemPromptCount();
}

function updateSystemPromptCount() {
  const length = elements.systemPromptInput.value.length;
  elements.systemPromptCount.textContent = `${length.toLocaleString()} / 1,500`;
}

function applyStoredTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  const preferredDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  setTheme(stored || (preferredDark ? "dark" : "light"));
}

function toggleTheme() {
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  elements.themeIcon.textContent = theme === "dark" ? "☀" : "☾";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#171a2d" : "#6d5dfc");
}

function updateCharacterCount() {
  const length = elements.promptInput.value.length;
  elements.characterCount.textContent = `${length.toLocaleString()} / 4,000`;
}

function autoResizeTextarea() {
  elements.promptInput.style.height = "auto";
  elements.promptInput.style.height = `${Math.min(elements.promptInput.scrollHeight, 170)}px`;
}

function scrollToLatest() {
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function formatTime(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function loadJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 3_800);
}
