import PageHeader from "@/components/PageHeader";
import { Construction } from "lucide-react";

export default function VentasWalmartPage() {
  return (
    <div>
      <PageHeader
        title="Walmart — Ventas"
        description="Integración con Walmart Chile (Mirakl)."
      />
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800 flex items-start gap-3">
        <Construction className="w-5 h-5 mt-0.5 shrink-0" />
        <div>
          <div className="font-medium">Pendiente de integración</div>
          <div className="text-sm mt-1">
            Walmart Chile usa la plataforma Mirakl. Para conectarlo necesito el
            <strong> API Key</strong> de Mirakl (se obtiene desde el Seller Center
            de Walmart Chile → Settings → API).
          </div>
        </div>
      </div>
    </div>
  );
}
