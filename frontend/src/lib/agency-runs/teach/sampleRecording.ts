/**
 * A sample recorder stream (structure only, as the in-page recorder emits
 * it) of someone filing on a generic permit portal: entry → sign-in →
 * business info → documents → review, then reaching for "Radicar".
 * Used by the unit tests and the mocked-recorder e2e; never by production.
 */
export const SAMPLE_PORTAL_URL = "https://permisos.ejemplo.pr.gov/";

export function sampleRecorderEvents(base = SAMPLE_PORTAL_URL): Record<string, unknown>[] {
  const u = (p: string) => new URL(p, base).toString();
  const page = (path: string, heading: string, extra: Record<string, unknown> = {}) => ({ kind: "page", url: u(path), title: "Portal de Permisos", heading, hasPassword: false, hasCaptcha: false, hasFileInput: false, ...extra });
  const fill = (path: string, label: string, selector: string, valueKind: string, extra: Record<string, unknown> = {}) => ({ kind: "fill", url: u(path), role: "textbox", label, selector, inputType: "text", valueKind, required: true, ...extra });
  const click = (path: string, label: string, selector: string, role = "button") => ({ kind: "click", url: u(path), role, label, selector, inputType: role === "link" ? "a" : "button" });
  return [
    page("/", "Bienvenido al Portal de Permisos"),
    click("/", "Solicitar permiso", "#solicitar", "link"),
    page("/entrar", "Iniciar sesión", { hasPassword: true }),
    fill("/entrar", "Correo electrónico", "#usuario", "email"),
    fill("/entrar", "Contraseña", "#clave", "secret", { inputType: "password" }),
    click("/entrar", "Entrar", "#entrar"),
    page("/solicitud/negocio", "Información del negocio"),
    fill("/solicitud/negocio", "Nombre legal del negocio", "#nombre-legal", "text"),
    fill("/solicitud/negocio", "Correo electrónico", "#email-negocio", "email"),
    fill("/solicitud/negocio", "Teléfono", "#telefono", "phone"),
    { ...fill("/solicitud/negocio", "Municipio", "#municipio", "option", { inputType: "select-one" }), role: "combobox", optionText: "San Juan" },
    click("/solicitud/negocio", "Siguiente", "#siguiente"),
    page("/solicitud/documentos", "Documentos requeridos", { hasFileInput: true }),
    fill("/solicitud/documentos", "Certificado de incorporación", "#doc-incorporacion", "file", { inputType: "file" }),
    click("/solicitud/documentos", "Continuar", "#continuar"),
    page("/solicitud/revision", "Revisión de la solicitud"),
    click("/solicitud/revision", "Radicar solicitud", "#radicar"),
  ];
}
