import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { integrations } from "@/server/env";
import Shell from "@/admin/Shell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/admin/login");
  return (
    <Shell me={user} integrations={integrations()}>
      {children}
    </Shell>
  );
}
