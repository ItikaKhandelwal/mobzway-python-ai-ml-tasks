const BOOT_KEY = "asknova-boot-v2";

function startApp() {
  if (window.__ASKNOVA_STARTED__) return;
  window.__ASKNOVA_STARTED__ = true;
  import(`/app.js?v=${BOOT_KEY}`).catch((error) => {
    console.error("AskNova failed to start:", error);
    const status = document.querySelector("#statusText");
    if (status) status.textContent = "App failed to load — refresh to retry";
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApp, { once: true });
} else {
  startApp();
}

window.addEventListener("pageshow", () => {
  window.dispatchEvent(new Event("online"));
});
