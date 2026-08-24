# React Widget Wrapper and Draft Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a private React lifecycle wrapper and replace the Customize mock
with an isolated real-widget preview driven by unsaved settings.

**Architecture:** Extend `@chatai/widget` with an explicit mount-options
contract and a contained layout. `@chatai/react` delegates every mount to that
package. The dashboard keeps a local draft, passes it to the wrapper, and only
submits it to the server action on Save.

**Tech Stack:** TypeScript, React 19 peer API compatible with React 18, Preact,
Vitest, jsdom, Next.js App Router, Tailwind CSS.

## Global Constraints

- `@chatai/react` remains private and source-exported.
- Preact stays internal to `@chatai/widget`.
- The wrapper must not duplicate widget UI, fetch, SSE, or controller logic.
- Preview values are never persisted until Save.
- Preview uses an absolute API URL, contained layout, and inert storage.
- Production widget embeds keep their existing fixed viewport layout.

---

### Task 1: Extend widget mount options for preview overrides

**Files:**

- Modify: `packages/widget/src/app.tsx`
- Modify: `packages/widget/src/mount.tsx`
- Modify: `packages/widget/src/styles.css`
- Modify: `packages/widget/src/index.ts`
- Test: `packages/widget/src/mount.test.ts`

**Interfaces:**

- Produces `WidgetMountOptions`, exported from `@chatai/widget`.
- `WidgetMountOptions` includes controller options, `primaryColor`, `position`,
  `theme`, `iconUrl`, `suggestedQuestions`, `showSources`, and
  `layout?: "fixed" | "contained"`.
- `mountWidget(target, options): WidgetInstance` preserves the existing
  production behavior when `layout` is omitted.

- [ ] **Step 1: Write the failing widget tests**

```tsx
it("uses mount overrides ahead of public config", async () => {
  const instance = mountWidget(target, {
    assistantId: "asst_demo",
    apiUrl: "https://chat.example.com",
    primaryColor: "#112233",
    suggestedQuestions: ["Draft question"],
  });

  await Promise.resolve();
  expect(target.shadowRoot?.querySelector(".chatai-widget")).toHaveStyle({
    "--chatai-accent": "#112233",
  });
  expect(target.shadowRoot?.textContent).toContain("Draft question");
  instance.destroy();
});

it("keeps contained previews inside their host", async () => {
  const instance = mountWidget(target, {
    assistantId: "asst_demo",
    apiUrl: "https://chat.example.com",
    layout: "contained",
  });

  await Promise.resolve();
  expect(target.shadowRoot?.querySelector(".chatai-widget")).toHaveClass("layout-contained");
  instance.destroy();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @chatai/widget test -- src/mount.test.ts`  
Expected: FAIL because `WidgetMountOptions` does not expose draft overrides and
the rendered widget does not apply them.

- [ ] **Step 3: Implement the minimal mount contract**

```ts
export type WidgetMountOptions = WidgetControllerOptions & {
  primaryColor?: string;
  position?: "bottom-left" | "bottom-right";
  theme?: "light" | "dark" | "system";
  iconUrl?: string | null;
  suggestedQuestions?: string[];
  showSources?: boolean;
  layout?: "fixed" | "contained";
};
```

Merge explicit props after the fetched `settings`, add
`layout-contained` when requested, and scope contained positioning inside the
host instead of the viewport.

- [ ] **Step 4: Run the widget test to verify it passes**

Run: `pnpm --filter @chatai/widget test -- src/mount.test.ts`  
Expected: PASS with no failed tests.

### Task 2: Add the thin React wrapper

**Files:**

- Create: `packages/react/package.json`
- Create: `packages/react/tsconfig.json`
- Create: `packages/react/src/client.ts`
- Create: `packages/react/src/chat-widget.tsx`
- Create: `packages/react/src/index.ts`
- Test: `packages/react/src/chat-widget.test.tsx`

**Interfaces:**

- Consumes `mountWidget`, `WidgetInstance`, and `WidgetMountOptions` from
  `@chatai/widget`.
- Produces `mountChatWidget(element, options): WidgetInstance`.
- Produces `ChatWidget(props): React.ReactElement | null`.

- [ ] **Step 1: Write the failing React lifecycle tests**

```tsx
it("mounts once and destroys its widget on unmount", () => {
  const { unmount } = render(
    <ChatWidget assistantId="asst_demo" apiUrl="https://chat.example.com" />,
  );
  expect(mountWidget).toHaveBeenCalledTimes(1);
  unmount();
  expect(destroy).toHaveBeenCalledTimes(1);
});

it("remounts only after a supported widget option changes", () => {
  const view = render(<ChatWidget assistantId="asst_demo" apiUrl="https://chat.example.com" />);
  view.rerender(
    <ChatWidget assistantId="asst_demo" apiUrl="https://chat.example.com" className="shell" />,
  );
  expect(mountWidget).toHaveBeenCalledTimes(1);
  view.rerender(
    <ChatWidget assistantId="asst_demo" apiUrl="https://chat.example.com" theme="dark" />,
  );
  expect(mountWidget).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @chatai/react test -- src/chat-widget.test.tsx`  
Expected: FAIL because package `@chatai/react` and its exports do not exist.

- [ ] **Step 3: Implement wrapper lifecycle**

```tsx
export function ChatWidget({ className, onReady, onError, ...options }: ChatWidgetProps) {
  const targetRef = useRef<HTMLDivElement>(null);

  useEffect(
    () => {
      if (!targetRef.current) return;
      try {
        const instance = mountChatWidget(targetRef.current, options);
        onReady?.();
        return () => instance.destroy();
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error("Widget mount failed."));
      }
    },
    [/* supported WidgetMountOptions only */],
  );

  return <div ref={targetRef} className={className} />;
}
```

Use React 18/19 peer ranges; include `react` and `react-dom` only as package
development dependencies for tests.

- [ ] **Step 4: Run the React test and typecheck**

Run: `pnpm --filter @chatai/react test && pnpm --filter @chatai/react typecheck`  
Expected: PASS with no TypeScript errors.

### Task 3: Replace the Customize mock with an isolated draft preview

**Files:**

- Create: `apps/web/src/components/assistants/widget-preview.tsx`
- Modify: `apps/web/src/components/assistants/customize-form.tsx`
- Modify: `apps/web/src/app/dashboard/assistants/[id]/customize/page.tsx`
- Test: `apps/web/src/components/assistants/widget-preview.test.tsx`
- Modify: `apps/web/package.json`

**Interfaces:**

- Consumes `ChatWidget` from `@chatai/react`.
- `WidgetPreview` accepts `assistantId`, `apiUrl`, assistant name, and a full
  local `AssistantSettings` draft.
- Customize owns the draft and uses it for both form fields and `WidgetPreview`.

- [ ] **Step 1: Write the failing draft-preview test**

```tsx
it("passes unsaved draft settings to an isolated contained widget", () => {
  render(
    <WidgetPreview
      assistantId="asst_demo"
      apiUrl="https://chat.example.com"
      settings={{ primaryColor: "#112233", theme: "dark", showSources: false }}
    />,
  );

  expect(ChatWidget).toHaveBeenCalledWith(
    expect.objectContaining({
      layout: "contained",
      primaryColor: "#112233",
      theme: "dark",
      showSources: false,
    }),
    expect.anything(),
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @chatai/web test -- src/components/assistants/widget-preview.test.tsx`  
Expected: FAIL because `WidgetPreview` does not exist.

- [ ] **Step 3: Implement controlled draft fields and preview**

```tsx
const [draft, setDraft] = useState<AssistantSettings>(assistant.settings);

<WidgetPreview assistantId={assistant.publicId} apiUrl={apiUrl} settings={draft} />;
```

Replace `defaultValue` and `defaultChecked` fields with controlled inputs.
Build FormData-compatible values from the draft so the existing
`updateAssistantSettings` action continues to validate and persist. Add the
visible copy: `Draft preview — not published until you save.` Pass a storage
object with no-op `getItem`, `setItem`, and `removeItem` methods.

- [ ] **Step 4: Run the dashboard test and typecheck**

Run: `pnpm --filter @chatai/web test -- src/components/assistants/widget-preview.test.tsx && pnpm --filter @chatai/web typecheck`  
Expected: PASS with no test failures or TypeScript errors.

### Task 4: Run integrated verification

**Files:**

- Modify: `.cursor/plans/v0.2-widget-delivery_4377be0c.plan.md`

- [ ] **Step 1: Run focused package and dashboard tests**

Run: `pnpm --filter @chatai/widget test && pnpm --filter @chatai/react test && pnpm --filter @chatai/web test`  
Expected: all suites pass.

- [ ] **Step 2: Run all changed-package checks**

Run: `pnpm --filter @chatai/widget typecheck && pnpm --filter @chatai/react typecheck && pnpm --filter @chatai/web lint && pnpm --filter @chatai/web typecheck`  
Expected: zero lint and type errors.

- [ ] **Step 3: Build the hosted asset and web app**

Run: `pnpm widget:build && pnpm --filter @chatai/web build`  
Expected: widget size check, copied asset check, and Next build all succeed.

- [ ] **Step 4: Mark Task 6 complete**

Update Task 6-related todo states in the v0.2 plan only after every command
above exits successfully.
