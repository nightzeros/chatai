import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/** Reads root VERSION file for About / release surfaces. */
export function getProductVersion(): string {
  const candidates = [
    path.join(process.cwd(), "VERSION"),
    path.join(process.cwd(), "../../VERSION"),
    path.join(process.cwd(), "../../../VERSION"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, "utf8").trim() || "1.0.0";
    }
  }
  return "1.0.0";
}
