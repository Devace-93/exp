import type { PartialCatalog } from "./en";

/** Español (España) — overrides vs the Mexican base. */
const esES: PartialCatalog = {
  "early.bannerText":
    "Ahora mismo todas las cuentas tienen acceso completo sin coste. Los planes y límites se introducirán más adelante, con aviso antes de cualquier cambio.",
  "auth.loginSubtitle": "Bienvenido de nuevo a exp.",
  "auth.inviteOnlyBody": "Estamos abriendo poco a poco. Mantente al tanto: pronto habrá plazas.",
  "dash.empty": "Aún no hay proyectos. Crea el primero para obtener tres entornos y tus claves de cliente.",
  "psettings.oneTimeKey": "Copia esta clave de cliente ahora: no se volverá a mostrar.",
  "billing.notConfigured":
    "La facturación todavía no está configurada (falta VITE_REVENUECAT_PUBLIC_KEY). Añade tu clave pública de RevenueCat Web Billing a .env y vuelve a construir la imagen web.",
};
export default esES;
