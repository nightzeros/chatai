import { optionsFromScript } from "./bootstrap";
import { mountWidget } from "./mount";

declare global {
  interface Window {
    ChatAIWidget?: {
      mount: typeof mountWidget;
    };
  }
}

function boot() {
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>("script[data-assistant-id]"));

  for (const script of scripts) {
    if (script.dataset.chataiMounted === "true") continue;
    try {
      const target = document.createElement("chatai-widget-host");
      script.insertAdjacentElement("afterend", target);
      mountWidget(target, optionsFromScript(script));
      script.dataset.chataiMounted = "true";
    } catch (error) {
      console.error("[ChatAI] Widget failed to start.", error);
    }
  }
}

window.ChatAIWidget = { mount: mountWidget };
boot();
