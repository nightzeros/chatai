"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AssistantWorkspaceSibling = { id: string; name: string };

export type AssistantWorkspaceValue = {
  id: string;
  name: string;
  publicId: string;
  siblings: AssistantWorkspaceSibling[];
};

type AssistantWorkspaceContextValue = {
  workspace: AssistantWorkspaceValue | null;
  setWorkspace: (value: AssistantWorkspaceValue | null) => void;
};

const AssistantWorkspaceContext = createContext<AssistantWorkspaceContextValue | null>(null);

export function AssistantWorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspaceState] = useState<AssistantWorkspaceValue | null>(null);
  const setWorkspace = useCallback((value: AssistantWorkspaceValue | null) => {
    setWorkspaceState(value);
  }, []);
  const value = useMemo(() => ({ workspace, setWorkspace }), [workspace, setWorkspace]);

  return (
    <AssistantWorkspaceContext.Provider value={value}>{children}</AssistantWorkspaceContext.Provider>
  );
}

export function useAssistantWorkspace() {
  const ctx = useContext(AssistantWorkspaceContext);
  if (!ctx) {
    throw new Error("useAssistantWorkspace must be used within AssistantWorkspaceProvider");
  }
  return ctx;
}

/** Registers the current assistant in the app shell nav; clears on unmount. */
export function AssistantWorkspaceRegistrar({
  workspace,
  children,
}: {
  workspace: AssistantWorkspaceValue;
  children: ReactNode;
}) {
  const { setWorkspace } = useAssistantWorkspace();

  const { id, name, publicId, siblings } = workspace;
  const siblingsKey = siblings.map((s) => `${s.id}:${s.name}`).join("|");

  useEffect(() => {
    setWorkspace({ id, name, publicId, siblings });
    return () => setWorkspace(null);
    // siblingsKey stands in for siblings identity
    // eslint-disable-next-line react-hooks/exhaustive-deps -- avoid resetting on new array refs
  }, [setWorkspace, id, name, publicId, siblingsKey]);

  return <>{children}</>;
}
