"use client";

import { useRouter } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
    <div className="mt-2">
      <span className="sr-only">Switch assistant</span>
      <Select
        value={currentId}
        onValueChange={(id) => {
          router.push(`/dashboard/assistants/${id}`);
        }}
      >
        <SelectTrigger className="h-8 w-full text-xs" aria-label="Switch assistant">
          <SelectValue placeholder="Switch assistant" />
        </SelectTrigger>
        <SelectContent>
          {assistants.map((a) => (
            <SelectItem key={a.id} value={a.id} className="text-xs">
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
