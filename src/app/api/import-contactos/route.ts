import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const CONTACTOS = [
  { tax_id: "30710946147", nombre: "LINKSIDE SOCIEDAD ANONIMA" },
  { tax_id: "30639453738", nombre: "TELECOM ARGENTINA SOCIEDAD ANONIMA" },
  { tax_id: "30716678977", nombre: "PAPRIKA DREAM TEAM SOCIEDAD POR ACCIONES SIMPLIFICADA" },
  { tax_id: "27364006328", nombre: "GOLDMAN CAMILA" },
  { tax_id: "33525495669", nombre: "CAMARA ARGENTINA DEL LIBRO" },
  { tax_id: "30711985766", nombre: "PEDIDOSYA S.A." },
  { tax_id: "30715185942", nombre: "SUSTENT-PACK S.R.L." },
  { tax_id: "30546741253", nombre: "OSDE ORGANIZACION DE SERVICIOS DIRECTOS EMPRESARIOS" },
  { tax_id: "33693450239", nombre: "ADMINISTRACION FEDERAL DE INGRESOS PUBLICOS" },
  { tax_id: "30715686054", nombre: "MELI LOG SRL" },
  { tax_id: "30703088534", nombre: "MERCADOLIBRE S.R.L." },
  { tax_id: "30710964277", nombre: "LAKAUT S.A." },
  { tax_id: "20329492436", nombre: "SEJAS ALFREDO" },
  { tax_id: "30712246428", nombre: "JUST SOLUTION S.A." },
  { tax_id: "30548083156", nombre: "COTO CENTRO INTEGRAL DE COMERCIALIZACION SOCIEDAD ANONIMA" },
  { tax_id: "30708053100", nombre: "ID GROUP S.A." },
  { tax_id: "27273872987", nombre: "BLANCO CELESTE NATACHA" },
  { tax_id: "20227043548", nombre: "CALDERONE LEANDRO HERNAN" },
  { tax_id: "30716242273", nombre: "AIDI S.A." },
  { tax_id: "30716786796", nombre: "INTEGRALY SOFTWARE" },
  { tax_id: "30710283547", nombre: "GESTION DE EMPRENDIMIENTOS DEPORTIVOS SA" },
  { tax_id: "20373400514", nombre: "MINGO MARCOS" },
  { tax_id: "30714346926", nombre: "TICARGAS INTERNATIONAL LOGISTICS SERVICES S.A." },
  { tax_id: "20217952698", nombre: "ECHANIQUE GREGORIO ROBERTO" },
  { tax_id: "30696170580", nombre: "AEROPUERTOS ARGENTINA 2000 S A" },
  { tax_id: "30712019359", nombre: "LINKEDSTORE ARGENTINA S.R.L." },
  { tax_id: "30710404611", nombre: "AGENCIA DE RECAUDACION DE LA PROVINCIA DE BUENOS AIRES" },
  { tax_id: "33717037109", nombre: "TENDENCYS INNOVATIONS S.A." },
  { tax_id: "30657864117", nombre: "NATURGY BAN S.A" },
  { tax_id: "30655116202", nombre: "EMPRESA DISTRIBUIDORA Y COMERCIALIZADORA NORTE SOCIEDAD ANONIMA (EDENOR S A)" },
  { tax_id: "20162465296", nombre: "D EBOLI GABRIEL REINALDO" },
  { tax_id: "30590360763", nombre: "CENCOSUD S A" },
  { tax_id: "20367853094", nombre: "ALBRIZIO FELIPE" },
  { tax_id: "30500833781", nombre: "LONGVIE S A" },
  { tax_id: "30688384547", nombre: "SERVICIO NACIONAL DE SANIDAD Y CALIDAD AGROALIMENTARIA SENASA" },
  { tax_id: "33637552649", nombre: "SUPERBOL SRL" },
  { tax_id: "20298236134", nombre: "ROMERO GONZALO ANTONIO" },
  { tax_id: "30712433104", nombre: "ID SYSTEMS S.A." },
  { tax_id: "30584715932", nombre: "DHL GLOBAL FORWARDING (ARGENTINA) SA" },
  { tax_id: "30714904775", nombre: "TERCER HOMBRE S.R.L." },
  { tax_id: "30710866038", nombre: "FARMACIA TOMKINSOM 2995 S.C.S." },
];

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const effectiveId = (user.user_metadata?.owner_id as string | undefined) ?? user.id;

    // Get active config to know ctx_pais
    const { data: configs } = await supabase.from("config").select("pais, is_active").eq("user_id", effectiveId);
    const active = configs?.find(c => c.is_active) ?? configs?.[0];
    if (!active?.pais) return NextResponse.json({ error: "No se encontró configuración de país" }, { status: 400 });
    const pais = active.pais;

    // Get existing tax_ids to avoid duplicates
    const { data: existing } = await supabase
      .from("contactos")
      .select("tax_id")
      .eq("user_id", effectiveId)
      .eq("ctx_pais", pais);

    const existingTaxIds = new Set((existing ?? []).map(c => c.tax_id).filter(Boolean));

    const toInsert = CONTACTOS.filter(c => !existingTaxIds.has(c.tax_id)).map(c => ({
      user_id: effectiveId,
      ctx_pais: pais,
      tipo: "proveedor" as const,
      nombre: c.nombre,
      tax_id: c.tax_id,
    }));

    const skipped = CONTACTOS.filter(c => existingTaxIds.has(c.tax_id));

    if (toInsert.length === 0) {
      return NextResponse.json({ ok: true, insertados: 0, omitidos: skipped.length, detalle: "Todos ya existían." });
    }

    const { data: inserted, error } = await supabase.from("contactos").insert(toInsert).select();
    if (error) throw new Error(error.message);

    return NextResponse.json({
      ok: true,
      insertados: inserted?.length ?? toInsert.length,
      omitidos: skipped.length,
      pais,
      detalle: inserted?.map(c => c.nombre),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
