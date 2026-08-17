import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { extractFromFile } from "./extract";

async function writeTemp(name: string, body: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "chatai-formats-"));
  const storagePath = path.join(dir, name);
  await writeFile(storagePath, body);
  return storagePath;
}

describe("CSV extraction", () => {
  it("turns each data row into a header: value block", async () => {
    const storagePath = await writeTemp(
      "plans.csv",
      ["Name,Plan", "Ada,Pro", "Bob,Free"].join("\n"),
    );

    await expect(extractFromFile({ storagePath, name: "plans.csv" })).resolves.toEqual([
      { content: "Name: Ada\nPlan: Pro" },
      { content: "Name: Bob\nPlan: Free" },
    ]);
  });

  it("keeps quoted commas inside CSV fields", async () => {
    const storagePath = await writeTemp("notes.csv", 'Name,Notes\n"Ada, Inc.","Hello, world"\n');

    await expect(extractFromFile({ storagePath, name: "notes.csv" })).resolves.toEqual([
      { content: "Name: Ada, Inc.\nNotes: Hello, world" },
    ]);
  });

  it("rejects a CSV file with no header row", async () => {
    const storagePath = await writeTemp("empty.csv", "\n\n");
    await expect(extractFromFile({ storagePath, name: "empty.csv" })).rejects.toThrow(/header/i);
  });
});

describe("JSON extraction", () => {
  it("extracts an array of strings as one block each", async () => {
    const storagePath = await writeTemp("items.json", JSON.stringify(["Alpha", "Beta"]));
    await expect(extractFromFile({ storagePath, name: "items.json" })).resolves.toEqual([
      { content: "Alpha" },
      { content: "Beta" },
    ]);
  });

  it("extracts an array of objects as key: value lines", async () => {
    const storagePath = await writeTemp(
      "rows.json",
      JSON.stringify([{ title: "Returns", days: 30 }]),
    );
    await expect(extractFromFile({ storagePath, name: "rows.json" })).resolves.toEqual([
      { content: "title: Returns\ndays: 30" },
    ]);
  });

  it("pretty-prints a JSON object as a single block", async () => {
    const storagePath = await writeTemp("policy.json", JSON.stringify({ title: "Policy", days: 30 }));
    await expect(extractFromFile({ storagePath, name: "policy.json" })).resolves.toEqual([
      { content: JSON.stringify({ title: "Policy", days: 30 }, null, 2) },
    ]);
  });

  it("rejects invalid JSON", async () => {
    const storagePath = await writeTemp("bad.json", "{not json");
    await expect(extractFromFile({ storagePath, name: "bad.json" })).rejects.toThrow(/json/i);
  });
});

describe("HTML extraction", () => {
  it("converts an HTML file to markdown heading blocks", async () => {
    const storagePath = await writeTemp(
      "returns.html",
      "<html><body><article><h1>Returns</h1><p>You have 30 days.</p></article></body></html>",
    );

    const blocks = await extractFromFile({ storagePath, name: "returns.html", mimeType: "text/html" });
    expect(blocks.some((block) => block.heading === "Returns" || block.content.includes("30 days"))).toBe(
      true,
    );
    expect(blocks.map((block) => block.content).join("\n")).not.toContain("<p>");
  });
});
