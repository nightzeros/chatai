/** @jsxImportSource preact */
import { render } from "preact";

import { WidgetApp, type WidgetAppProps } from "./app";
import styles from "./styles.generated";

export type WidgetInstance = {
  destroy(): void;
};

export type WidgetMountOptions = WidgetAppProps;

export function mountWidget(target: HTMLElement, options: WidgetMountOptions): WidgetInstance {
  const root = target.shadowRoot ?? target.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = styles;
  const host = document.createElement("div");
  host.className = options.layout === "contained" ? "chatai-widget-host-contained" : "";
  root.replaceChildren(style, host);

  render(<WidgetApp {...options} />, host);

  return {
    destroy() {
      render(null, host);
      root.replaceChildren();
    },
  };
}
