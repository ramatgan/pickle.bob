import GroupPageClient from "@/components/GroupPageClient";

export default async function GroupPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <GroupPageClient slug={slug} />;
}
