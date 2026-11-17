/** @jsxImportSource preact */
import { useEffect, useRef } from "preact/hooks";
import type {
  ResolvedVoiceAppearance,
  WidgetMessage,
  WidgetVoiceState,
} from "@nightzeros/chatai-widget-core";

import { MicGlyph } from "../voice-ui";
import { VoiceStage } from "./voice-stage";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type DockStageProps = {
  appearance: ResolvedVoiceAppearance;
  assistantName: string;
  voice: WidgetVoiceState;
  messages: WidgetMessage[];
  levels: () => { input: number; output: number };
  captionsOpen: boolean;
  onStart: () => void;
  onEnd: () => void;
  onMute: (muted: boolean) => void;
  onToggleCaptions: () => void;
  onRetry: () => void;
  onDismiss: () => void;
  onAcceptConsent: () => void;
  onDeclineConsent: () => void;
};

/**
 * Compact Dock surface — mounted as a sibling of the launch row (like the chat
 * panel) so Talk / chat buttons never shift when it opens.
 */
export function VoiceDockSurface({
  appearance,
  assistantName,
  voice,
  messages,
  levels,
  captionsOpen,
  onClose,
  onStart,
  onEnd,
  onMute,
  onToggleCaptions,
  onRetry,
  onDismiss,
  onAcceptConsent,
  onDeclineConsent,
}: DockStageProps & { onClose: () => void }) {
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = surfaceRef.current;
    if (!node) return;
    // Stable non-null binding for the keydown closure (ref.current is mutable to TS).
    const surface: HTMLDivElement = node;
    const focusables = () => Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE));
    focusables()[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusables();
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;
      const rootNode = surface.getRootNode();
      const active =
        rootNode instanceof ShadowRoot ? rootNode.activeElement : document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    surface.addEventListener("keydown", onKeyDown);
    return () => surface.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      ref={surfaceRef}
      className="chatai-dock-surface"
      role="dialog"
      aria-modal="true"
      aria-label={`${assistantName} voice`}
    >
      <VoiceStage
        assistantName={assistantName}
        voice={voice}
        messages={messages}
        levels={levels}
        captionsOpen={captionsOpen}
        layout="compact"
        reducedMotion={appearance.motion === "reduced"}
        accentColor={appearance.accentColor}
        onStart={onStart}
        onEnd={onEnd}
        onMute={onMute}
        onToggleCaptions={onToggleCaptions}
        onRetry={onRetry}
        onDismiss={onDismiss}
        onAcceptConsent={onAcceptConsent}
        onDeclineConsent={onDeclineConsent}
      />
    </div>
  );
}

/** Fixed Talk control in the launch row — label/size stay stable while open. */
export function VoiceDockTalk({
  open,
  onOpen,
  onClose,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  return (
    <button
      type="button"
      className={`chatai-dock-talk${open ? " is-open" : ""}`}
      onClick={() => (open ? onClose() : onOpen())}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={open ? "Close voice dock" : "Open voice talk"}
    >
      <MicGlyph off={open} />
      <span>Talk</span>
    </button>
  );
}
