import { redirect } from "next/navigation";

export default async function ProfileRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/assistants/${id}/identity`);
}
