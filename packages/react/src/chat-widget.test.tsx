// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatWidget } from "./chat-widget";
import { mountChatWidget } from "./client";

vi.mock("./client", () => ({
  mountChatWidget: vi.fn(),
}));

const mountMock = vi.mocked(mountChatWidget);

afterEach(() => {
  document.body.replaceChildren();
  mountMock.mockReset();
});

describe("ChatWidget", () => {
  it("mounts once and destroys the widget on unmount", async () => {
    const destroy = vi.fn();
    mountMock.mockReturnValue({ destroy });
    const target = document.createElement("div");
    document.body.append(target);
    const root = createRoot(target);

    await act(async () => {
      root.render(<ChatWidget assistantId="asst_demo" apiUrl="https://chat.example.com" />);
    });
    expect(mountMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("remounts for supported option changes but not wrapper class changes", async () => {
    const firstDestroy = vi.fn();
    const secondDestroy = vi.fn();
    mountMock.mockReturnValueOnce({ destroy: firstDestroy }).mockReturnValueOnce({ destroy: secondDestroy });
    const target = document.createElement("div");
    document.body.append(target);
    const root = createRoot(target);

    await act(async () => {
      root.render(<ChatWidget assistantId="asst_demo" apiUrl="https://chat.example.com" />);
    });
    await act(async () => {
      root.render(<ChatWidget assistantId="asst_demo" apiUrl="https://chat.example.com" className="shell" />);
    });
    expect(mountMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(<ChatWidget assistantId="asst_demo" apiUrl="https://chat.example.com" theme="dark" />);
    });
    expect(firstDestroy).toHaveBeenCalledTimes(1);
    expect(mountMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      root.unmount();
    });
  });
});
