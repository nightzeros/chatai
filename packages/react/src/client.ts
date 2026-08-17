import { mountWidget, type WidgetInstance, type WidgetMountOptions } from "@chatai/widget";

export type ChatWidgetOptions = WidgetMountOptions;

export function mountChatWidget(element: HTMLElement, options: ChatWidgetOptions): WidgetInstance {
  return mountWidget(element, options);
}
