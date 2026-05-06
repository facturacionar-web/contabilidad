import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import CommandPalette from "@/components/CommandPalette";
import KeyboardShortcuts from "@/components/KeyboardShortcuts";
import DateInputClickHandler from "@/components/DateInputClickHandler";
import ProveedoresConfigSync from "@/components/ProveedoresConfigSync";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <>
      <Sidebar />
      <div className="pl-64">
        <Topbar userEmail={user.email ?? ""} />
        <main className="p-6">{children}</main>
      </div>
      <CommandPalette />
      <KeyboardShortcuts />
      <DateInputClickHandler />
      <ProveedoresConfigSync />
    </>
  );
}
