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

function mockInstance() {
  return { destroy: vi.fn(), update: vi.fn() };
}

afterEach(() => {
  document.body.replaceChildren();
  mountMock.mockReset();
});

describe("ChatWidget", () => {
  it("mounts once and destroys the widget on unmount", async () => {
    const instance = mockInstance();
    mountMock.mockReturnValue(instance);
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
    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });

  it("updates presentation props without remounting; remounts on identity changes", async () => {
    const first = mockInstance();
    const second = mockInstance();
    mountMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
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
      root.render(
        <ChatWidget
          assistantId="asst_demo"
          apiUrl="https://chat.example.com"
          theme="dark"
          voiceAppearance={{ experience: "orb" }}
        />,
      );
    });
    expect(first.destroy).not.toHaveBeenCalled();
    expect(mountMock).toHaveBeenCalledTimes(1);
    expect(first.update).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: "dark",
        voiceAppearance: { experience: "orb" },
      }),
    );

    await act(async () => {
      root.render(
        <ChatWidget assistantId="asst_other" apiUrl="https://chat.example.com" theme="dark" />,
      );
    });
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(mountMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      root.unmount();
    });
  });
});
