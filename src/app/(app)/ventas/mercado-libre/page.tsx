import PageHeader from "@/components/PageHeader";
import { Construction } from "lucide-react";

export default function VentasMercadoLibrePage() {
  return (
    <div>
      <PageHeader
        title="Mercado Libre Chile — Ventas"
        description="Integración con Mercado Libre Chile."
      />
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800 flex items-start gap-3">
        <Construction className="w-5 h-5 mt-0.5 shrink-0" />
        <div>
          <div className="font-medium">Pendiente de integración</div>
          <div className="text-sm mt-1">
            Necesito que crees una aplicación en{" "}
            <a className="underline" href="https://developers.mercadolibre.cl/devcenter">
              developers.mercadolibre.cl/devcenter
            </a>{" "}
            y me pases <strong>Client ID</strong> y <strong>Client Secret</strong> de la
            cuenta de Mercado Libre Chile. (El código de ML Argentina ya existe en
            <code className="text-xs"> lib/ml/</code> y se puede reutilizar para CL.)
          </div>
        </div>
      </div>
    </div>
  );
}
