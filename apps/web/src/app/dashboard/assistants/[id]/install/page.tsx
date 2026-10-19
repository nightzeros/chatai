import { redirect } from "next/navigation";

export default async function InstallRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/assistants/${id}/widget?tab=embed`);
}
