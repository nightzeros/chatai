import { mountWidget, type WidgetInstance, type WidgetMountOptions } from "@nightzeros/chatai-widget";

export type ChatWidgetOptions = WidgetMountOptions;

export function mountChatWidget(element: HTMLElement, options: ChatWidgetOptions): WidgetInstance {
  return mountWidget(element, options);
}
