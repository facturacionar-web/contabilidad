import { redirect } from "next/navigation";

export default function GastosRedirect() {
  redirect("/egresos/facturas");
}
