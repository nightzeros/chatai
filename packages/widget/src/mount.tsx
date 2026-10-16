/** @jsxImportSource preact */
import { render } from "preact";

import { WidgetApp, type WidgetAppProps } from "./app";
import styles from "./styles.generated";

export type WidgetInstance = {
  /** Re-render with merged options without destroying the controller when identity deps are unchanged. */
  update(next: Partial<WidgetMountOptions>): void;
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

  let current: WidgetMountOptions = options;
  const paint = () => {
    host.className = current.layout === "contained" ? "chatai-widget-host-contained" : "";
    render(<WidgetApp {...current} />, host);
  };
  paint();

  return {
    update(next) {
      current = { ...current, ...next };
      paint();
    },
    destroy() {
      render(null, host);
      root.replaceChildren();
    },
  };
}
