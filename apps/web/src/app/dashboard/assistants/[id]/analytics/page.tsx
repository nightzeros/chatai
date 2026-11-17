import { redirect } from "next/navigation";

export default async function AnalyticsRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/assistants/${id}/insights`);
}
