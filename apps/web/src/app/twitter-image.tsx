import { ImageResponse } from "next/og";

import { brand } from "@/lib/site";

export const runtime = "edge";
export const alt = "ChatAI — Your knowledge. Your AI. Anywhere.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function TwitterImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          backgroundColor: "#05060c",
          backgroundImage:
            "radial-gradient(ellipse 70% 55% at 15% 85%, rgba(123,140,255,0.22), transparent 60%), linear-gradient(to right, rgba(139,156,200,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(139,156,200,0.08) 1px, transparent 1px)",
          backgroundSize: "100% 100%, 72px 72px, 72px 72px",
          color: "#f4f6fb",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <svg width="96" height="96" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="7" fill="#05060c" />
            <rect
              x="0.75"
              y="0.75"
              width="30.5"
              height="30.5"
              rx="6.25"
              fill="none"
              stroke="#8b9cc8"
              strokeOpacity="0.35"
              strokeWidth="1"
            />
            <circle cx="12.25" cy="16" r="3.15" fill="#f4f6fb" />
            <path
              d="M17.1 12.85 L23.4 10.55"
              stroke="#7b8cff"
              strokeWidth="2.35"
              strokeLinecap="round"
            />
            <path
              d="M17.1 19.15 L23.4 21.45"
              stroke="#f4f6fb"
              strokeWidth="2.35"
              strokeLinecap="round"
            />
          </svg>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div
              style={{
                fontSize: 84,
                fontWeight: 700,
                letterSpacing: "-0.04em",
                lineHeight: 1,
              }}
            >
              {brand.product.name}
            </div>
            <div
              style={{
                fontSize: 34,
                fontWeight: 500,
                letterSpacing: "-0.02em",
                color: "#e8ecff",
                lineHeight: 1.2,
              }}
            >
              Your knowledge. Your AI. Anywhere.
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            opacity: 0.72,
            fontSize: 22,
            letterSpacing: "0.04em",
          }}
        >
          <span style={{ color: "#a8b3d4" }}>A {brand.company.name} project</span>
          <span
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 18,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "#8b9cc8",
            }}
          >
            {brand.product.projectNumber}
          </span>
        </div>
      </div>
    ),
    { ...size },
  );
}
