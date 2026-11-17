import { SettingsSubnav } from "@/components/assistants/settings-subnav";
import { PageHeader } from "@/components/ui/page-header";

export default async function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Models, retrieval, voice, privacy, and security for this assistant."
      />
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        <SettingsSubnav assistantId={id} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
