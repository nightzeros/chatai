import { DashboardShell } from "@/components/layout/dashboard-shell";
import { getDocsUrl } from "@/lib/docs-url";
import { requireSession } from "@/lib/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const docsUrl = getDocsUrl();

  return (
    <DashboardShell docsUrl={docsUrl} userEmail={session.user.email}>
      {children}
    </DashboardShell>
  );
}
