export type WidgetInstance = {
  destroy(): void;
};

export type WidgetMountOptions = {
  assistantId: string;
  apiUrl: string;
  fetch?: typeof globalThis.fetch;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  createId?: () => string;
  primaryColor?: string;
  position?: "bottom-left" | "bottom-right";
  theme?: "light" | "dark" | "system";
  iconUrl?: string | null;
  suggestedQuestions?: string[];
  showSources?: boolean;
  layout?: "fixed" | "contained";
};

export declare function mountWidget(target: HTMLElement, options: WidgetMountOptions): WidgetInstance;
