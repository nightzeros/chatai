"use client";

import { useRouter } from "next/navigation";

export function AssistantSwitcher({
  currentId,
  assistants,
}: {
  currentId: string;
  assistants: { id: string; name: string }[];
}) {
  const router = useRouter();

  if (assistants.length <= 1) return null;

  return (
    <label className="mt-2 block">
      <span className="sr-only">Switch assistant</span>
      <select
        className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
        value={currentId}
        aria-label="Switch assistant"
        onChange={(e) => {
          router.push(`/dashboard/assistants/${e.target.value}`);
        }}
      >
        {assistants.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );
}
