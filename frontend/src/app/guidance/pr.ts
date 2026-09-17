import type { GuidanceConcept, GuidanceCondition, GuidanceSource, LocalizedText } from "./model";

const text = (en: string, es: string): LocalizedText => ({ en, es });
const condition = (key: GuidanceCondition["key"], en: string, es: string, equals?: string | boolean): GuidanceCondition => ({ key, label: text(en, es), ...(equals === undefined ? {} : { equals }) });
const source = (id: string, agency: string, citation: string, url: string, supports: string): GuidanceSource => ({ id, agency, citation, url, supports, lastVerified: "2026-09-03", sourceVersion: "public-guidance-2026-09-03" });

export const PR_GUIDANCE_SOURCES = {
  alcohol: source("SRC_GUIDANCE_ALCOHOL", "Departamento de Hacienda", "Internal Revenue Code, Subtitle E; licensing FAQs", "https://hacienda.pr.gov/sites/default/files/codigo_de_rentas_internas.pdf", "Subtitle E, sections 5050.01–5050.18: licensing alcoholic-beverage dealers and limits on licensed sales."),
  ein: source("SRC_GUIDANCE_EIN", "Internal Revenue Service", "Employer identification number — who needs an EIN; confirmation", "https://www.irs.gov/businesses/employer-identification-number", "Employers need an EIN; IRS confirmation documents the assigned number; form the legal entity before applying."),
  merchant: source("SRC_GUIDANCE_MERCHANT", "Departamento de Hacienda", "SURI — merchant location registration and certificates", "https://hacienda.pr.gov/transacciones-que-puedes-realizar-traves-de-suri", "SURI registers merchant locations and issues the Merchant Registration Certificate electronically."),
  merchantLaw: source("SRC_GUIDANCE_MERCHANT_RULE", "Departamento de Hacienda", "Regulation 8942 — Merchant Registration Certificate", "https://hacienda.pr.gov/sites/default/files/8942.pdf", "Merchant registration identifies each commercial location and whether the merchant is an IVU withholding agent."),
  permiso: source("SRC_GUIDANCE_PU", "OGPe", "Nonresidential use — permits for a business or activity", "https://www.permisos.pr.gov/", "Nonresidential uses require the Permiso Único process; check permitted use and applicable special licenses in SBP."),
  codigoMunicipal: source("SRC_GUIDANCE_CODIGO_MUNICIPAL", "Oficina de Gerencia y Presupuesto (OGP)", "Código Municipal de Puerto Rico — Ley 107-2020, según enmendada", "https://docs.pr.gov/files/JP-Junta%20de%20Planificacion/Leyes/Codigo-Municipal-de-Puerto-Rico-Ley-107-2020.pdf", "Ley 107-2020, Arts. 7.200–7.207: la patente municipal grava el volumen de negocios de la actividad comercial en el municipio."),
  ogpCarta: source("SRC_GUIDANCE_OGP_CC_002_2022", "Oficina de Gerencia y Presupuesto (OGP)", "Carta Circular 002-2022 — disposiciones sobre cumplimiento contributivo municipal", "https://docs.pr.gov/files/OGP/Website_OGP/CartasCirculares/CC2022/CC-002-2022.pdf", "La Carta Circular 002-2022 de OGP establece las disposiciones sobre la certificación de cumplimiento contributivo municipal."),
  propertyEvidence: source("SRC_GUIDANCE_PROPERTY_EVIDENCE", "OGPe", "Single Business Portal — evidencia de la propiedad en las solicitudes de permiso", "https://www.permisos.pr.gov/", "La evidencia de control del predio (escritura o contrato de arrendamiento) forma parte del expediente de permisos."),
  dtrh: source("SRC_GUIDANCE_DTRH", "Departamento del Trabajo y Recursos Humanos", "Registro de patronos — seguro por desempleo e incapacidad", "https://patronos.trabajo.pr.gov/patronos/Help/Help_ES/radicacindesolicituddenmeropatronalparadesempleoeincapacidad.htm", "El portal de patronos del DTRH procesa la solicitud del número patronal para el seguro por desempleo e incapacidad."),
  entity: source("SRC_GUIDANCE_ENTITY", "Departamento de Estado", "Corporations — LLC formation by Certificate of Organization", "https://www.estado.pr.gov/corporaciones", "An LLC is created through a Certificate of Organization; corporations use the incorporation process."),
  cfse: source("SRC_GUIDANCE_CFSE", "Corporación del Fondo del Seguro del Estado", "Employer information — workers compensation coverage", "https://old.fondopr.com/patronos/informacion-general/", "Employers hire compensated workers; insured employers formalize a CFSE policy, report payroll, risks and locations, and pay premiums."),
  zoning: source("SRC_GUIDANCE_ZONING", "OGPe", "Single Business Portal — land use / zoning consultation", "https://www.permisos.pr.gov/", "SBP's location consultation confirms the permitted use classification for the premises before a use permit is issued."),
  health: source("SRC_GUIDANCE_HEALTH", "Departamento de Salud", "Reglamento General de Salud Ambiental — sanitary permit for establishments", "https://www.salud.pr.gov/", "Establishments handling food or serving the public are subject to sanitary-permit inspection under environmental health regulation."),
  fire: source("SRC_GUIDANCE_FIRE", "Cuerpo de Bomberos de Puerto Rico", "Fire inspection certificate for commercial occupancy", "https://bomberos.pr.gov/", "Commercial premises open to the public or handling food/manufacturing require a fire-safety inspection certificate before occupancy."),
  cfpm: source("SRC_GUIDANCE_CFPM", "Departamento de Salud", "Manejador de Alimentos — certified food handler/manager requirement", "https://www.salud.pr.gov/", "Establishments that prepare food must have a certified food protection manager or handler on staff per sanitary regulation."),
  stormwater: source("SRC_GUIDANCE_STORMWATER", "EPA / Junta de Calidad Ambiental", "NPDES MS4 stormwater program", "https://www.epa.gov/npdes/npdes-stormwater-program", "Municipalities covered by an MS4 permit require regulated businesses to control runoff from their site under the NPDES stormwater program."),
  noise: source("SRC_GUIDANCE_NOISE", "Junta de Calidad Ambiental", "Reglamento de Control de Ruido — endorsement for elevated noise activity", "https://jca.pr.gov/", "Activities that generate elevated noise levels in designated municipal zones need a noise-control endorsement before operating."),
  waste: source("SRC_GUIDANCE_WASTE", "Autoridad de Desperdicios Sólidos", "Commercial solid waste collection and disposal", "https://www.ads.pr.gov/", "Commercial generators of solid waste must contract collection and disposal service rather than use residential collection."),
  parking: source("SRC_GUIDANCE_PARKING", "OGPe", "Single Business Portal — off-street parking requirement review", "https://www.permisos.pr.gov/", "The use-permit review confirms the premises provide the off-street parking required for the proposed commercial activity."),
  luma: source("SRC_GUIDANCE_LUMA", "Negociado de Energía de Puerto Rico", "Reglamento 8915 — interconexión de generadores con el sistema de distribución", "https://energia.pr.gov/wp-content/uploads/sites/7/2024/04/20240419-MI20190009-Mocion-en-Cumplimiento-de-Orden-Emitida-el-15-de-abril-de-2024.pdf", "The Negociado de Energía oversees the interconnection regulation for distributed generators connecting to the distribution system (Reglamento 8915)."),
  netMetering: source("SRC_GUIDANCE_NET_METERING", "Negociado de Energía de Puerto Rico", "Resolución sobre medición neta y energía distribuida", "https://energia.pr.gov/wp-content/uploads/sites/7/2024/06/20240614-MI20240006-Resolucion.pdf", "The Negociado de Energía regulates the net metering program and distributed energy under Ley 114-2007, as amended."),
  solarOgpe: source("SRC_GUIDANCE_SOLAR_OGPE", "OGPe", "Single Business Portal — construction and use permits", "https://www.permisos.pr.gov/", "Construction and use permits for energy projects are processed through OGPe's Single Business Portal; rooftop photovoltaic systems of 1 MW or less on existing structures are exempt from OGPe construction and use permits."),
  // REG-GUIDE-SOLAR-CONSTRUCTION-001: the OGPe construction permit is a
  // general document (new construction, expansions, structural work), so its
  // concept cites the general construction-permitting source, not the
  // solar-specific one.
  ogpeConstruction: source("SRC_GUIDANCE_OGPE_CONSTRUCTION", "OGPe", "Single Business Portal — construction permits", "https://www.permisos.pr.gov/", "Construction permits for new construction, expansions, and structural work are processed through OGPe's Single Business Portal under Puerto Rico's building codes (Ley 161-2009)."),
  daco: source("SRC_GUIDANCE_DACO", "Departamento de Asuntos del Consumidor", "Registro de Contratistas — Ley 146-1995 / Regl. 8172", "https://www.daco.pr.gov/", "DACO contractor certification is required before offering construction estimates or work on property the business does not own; urbanizador/constructor license under Regl. 8172; inscription renewed annually."),
  sam: source("SRC_GUIDANCE_SAM", "General Services Administration", "SAM.gov entity registration — annual renewal requirement", "https://www.gsa.gov/sell-to-government/step-3-manage-your-contract/comply-with-contractual-requirements", "Entity registration in SAM.gov must be renewed every 365 days to remain active; registration is required to bid on federal contracts and receive federal awards."),
  // Founder judgment 2026-09-16 (§29.2): ASUME, CRIM and the criminal-record
  // certificate are prerequisites of the retail alcohol beverage license, not
  // generic restaurant requirements. Hacienda's official license-requirements
  // page lists them for the Licencia de Traficante al Detalle de Bebidas
  // Alcohólicas.
  alcoholReqs: source("SRC_GUIDANCE_ALCOHOL_REQS", "Departamento de Hacienda", "Requisitos para cada tipo de licencia de rentas internas", "https://hacienda.pr.gov/comerciantes/licencias-de-rentas-internas/requisitos-para-cada-tipo-de-licencia-de-rentas-internas", "Hacienda's internal-revenue license requirements list the ASUME certification, the CRIM debt certification, and the criminal-record certificate among the prerequisites for the retail alcoholic-beverage dealer license."),
  antecedentes: source("SRC_GUIDANCE_ANTECEDENTES", "Policía de Puerto Rico", "Ley 254-1974, Art. 1 (34 L.P.R.A. § 1725)", "https://bvirtualogp.pr.gov/ogp/Bvirtual/leyesreferencia/PDF/Polic%C3%ADa/254-1974/254-1974.pdf", "Authorizes the Puerto Rico Police to issue the Certificado de Antecedentes Penales."),
};

const employee = condition("Q_EMPLOYEES_HIRED", "Hiring employees", "Contratación de empleados", true);
const municipality = condition("municipality", "Municipality", "Municipio");
const business = condition("businessType", "Commercial activity", "Actividad comercial");
const SUBJECTS: Record<string, { en: string[]; es: string[] }> = {
  DOC_ALCOHOL_LICENSE: { en: ["alcohol"], es: ["alcohol", "alcohólic"] },
  // §29.2: alcohol-license prerequisites — children of the alcohol license.
  DOC_ASUME_CLEARANCE: { en: ["asume", "child support clearance"], es: ["asume", "sustento de menores"] },
  DOC_CRIM_CLEARANCE: { en: ["crim", "property debt clearance"], es: ["crim", "deuda contributiva"] },
  DOC_BACKGROUND_CHECK: { en: ["criminal record", "antecedentes penales"], es: ["antecedentes penales", "certificado de antecedentes"] },
  DOC_EIN: { en: ["ein", "federal tax identifier"], es: ["ein", "identificador contributivo"] },
  DOC_SAM_REGISTRATION: { en: ["sam.gov", "federal registration", "federal contractor"], es: ["sam.gov", "registro federal", "contratista federal"] },
  DOC_CONTRACTOR_LICENSE: { en: ["DACO", "contractor registry", "urbanizador", "constructor"], es: ["DACO", "registro de contratistas", "urbanizador", "constructor"] },
  DOC_MERCHANT_REGISTRATION: { en: ["merchant", "suri", "ivu"], es: ["comerciante", "suri", "ivu"] },
  DOC_PERMISO_UNICO: { en: ["permit"], es: ["permiso", "solicitud en sbp"] },
  DOC_PATENTE_MUNICIPAL: { en: ["patent", "municipal tax"], es: ["patente", "contributivo municipal"] },
  DOC_LEASE_AGREEMENT: { en: ["lease", "landlord"], es: ["contrato", "arrendador"] },
  DOC_ARTICLES_ORGANIZATION: { en: ["llc", "limited liability company", "organization"], es: ["llc", "compañía de responsabilidad limitada", "organización"] },
  DOC_WORKERS_COMP: { en: ["cfse", "coverage"], es: ["cfse", "cobertura"] },
  DOC_DTRH_EMPLOYER_REG: { en: ["dtrh", "unemployment", "disability", "employer registration"], es: ["dtrh", "desempleo", "incapacidad", "patrono"] },



  DOC_HEALTH_PERMIT: { en: ["sanitary", "health"], es: ["sanitario", "salud"] },
  DOC_FIRE_CERT: { en: ["fire", "inspection"], es: ["bomberos", "inspección"] },
  DOC_CFPM: { en: ["food protection manager", "food handler"], es: ["manejador de alimentos"] },

  DOC_NOISE_VARIANCE: { en: ["noise"], es: ["ruido"] },

  DOC_LUMA_INTERCONNECTION: { en: ["luma", "interconnection", "grid connection"], es: ["luma", "interconexión", "conexión"] },
  DOC_NET_METERING_AGREEMENT: { en: ["net metering", "export"], es: ["medición neta", "exportar"] },
  DOC_OGPE_CONSTRUCTION_PERMIT: { en: ["ogpe", "construction permit"], es: ["ogpe", "permiso de construcción"] },
  DOC_OWNER_AFFIDAVIT: { en: ["affidavit", "owner authorization"], es: ["declaración jurada", "autorización del dueño"] },
  DOC_OPPE_INSTALLER_REG: { en: ["oppe", "installer registration"], es: ["oppe", "registro de instalador"] },
};
function concept(requirementId: string, conditions: GuidanceCondition[][], sources: GuidanceSource[], content: [LocalizedText, LocalizedText, LocalizedText, LocalizedText], dependencies: string[] = []): GuidanceConcept {
  return { requirementId, version: "2026-09-03.1", validationStatus: "validated", subjectTerms: SUBJECTS[requirementId], conditions, sources, regulatoryReason: content[0], purpose: content[1], nextAction: content[2], consequenceOrNextStep: content[3], dependencies,
    ...(requirementId === "DOC_EIN" ? { conditionalDependencies: [
      { entityType: "limited_liability_company", documentId: "DOC_ARTICLES_ORGANIZATION" },
      ...["stock_corporation", "close_corporation", "professional_corporation", "nonprofit_nonstock_corporation"].map(entityType => ({ entityType, documentId: "DOC_CERT_INCORPORATION" })),
    ] } : {}),
  };
}

// These are reusable concepts ON the document nodes, not an alternate matcher.
// No fees, deadlines or inferred customer facts. Local sources stay local.
export const PR_REQUIREMENT_GUIDANCE: Record<string, GuidanceConcept> = {
  DOC_ALCOHOL_LICENSE: concept("DOC_ALCOHOL_LICENSE", [[condition("Q_ALCOHOL_SOLD", "Alcohol sales: Yes", "Venta de alcohol: Sí", true)]], [PR_GUIDANCE_SOURCES.alcohol], [
    text("Selling alcoholic beverages is separately licensed. Ordinary business registration does not itself authorize alcohol sales.", "La venta de bebidas alcohólicas requiere una licencia específica. El registro del negocio por sí solo no autoriza esas ventas."),
    text("The Hacienda license authorizes the category of alcoholic-beverage sales specified in it.", "La licencia de Hacienda autoriza la categoría de venta de bebidas alcohólicas que especifica."),
    text("Confirm the sales category, complete the alcohol-license application, and supply the supporting evidence requested for that category.", "Confirma la categoría de venta, completa la solicitud de licencia de alcohol y aporta la evidencia de respaldo correspondiente."),
    text("Issuance authorizes only the alcohol sales covered by that license, subject to its conditions; a prepared application is not authorization.", "La expedición autoriza solo las ventas de alcohol cubiertas por la licencia y sus condiciones; una solicitud preparada no es una autorización."),
  ]),
  // §29.2 (founder judgment 2026-09-16): ASUME, CRIM and the criminal-record
  // certificate are prerequisites of the retail alcohol beverage license —
  // never generic restaurant requirements. Modeled as children of
  // DOC_ALCOHOL_LICENSE via dependencies.
  DOC_ASUME_CLEARANCE: concept("DOC_ASUME_CLEARANCE", [[condition("Q_ALCOHOL_SOLD", "Alcohol sales: Yes", "Venta de alcohol: Sí", true)]], [PR_GUIDANCE_SOURCES.alcoholReqs], [
    text("Hacienda requires the ASUME child-support clearance as a prerequisite for the retail alcohol beverage license — it proves the applicant owes no child-support debt to ASUME.", "Hacienda exige la certificación de ASUME como prerrequisito de la licencia de bebidas alcohólicas al detal — acredita que el solicitante no tiene deuda de sustento de menores con ASUME."),
    text("The ASUME clearance certifies child-support compliance; without it Hacienda will not issue the alcohol dealer license.", "La certificación de ASUME acredita el cumplimiento con el sustento de menores; sin ella Hacienda no expide la licencia de traficante de alcohol."),
    text("Request the ASUME certification through ASUME/Familia offices and file it with the alcohol-license application in SURI.", "Solicita la certificación de ASUME en las oficinas de ASUME/Familia y radícala junto a la solicitud de licencia de alcohol en SURI."),
    text("Once Hacienda accepts the ASUME clearance, the alcohol-license file moves forward; an expired or missing clearance stalls issuance.", "Una vez Hacienda acepta la certificación de ASUME, el expediente de la licencia de alcohol avanza; una certificación vencida o ausente detiene la expedición."),
  ], ["DOC_ALCOHOL_LICENSE"]),
  DOC_CRIM_CLEARANCE: concept("DOC_CRIM_CLEARANCE", [[condition("Q_ALCOHOL_SOLD", "Alcohol sales: Yes", "Venta de alcohol: Sí", true)]], [PR_GUIDANCE_SOURCES.alcoholReqs], [
    text("Hacienda requires the CRIM property debt clearance as a prerequisite for the retail alcohol beverage license — it certifies the applicant has no outstanding movable-property tax debt with CRIM.", "Hacienda exige la certificación de deuda del CRIM como prerrequisito de la licencia de bebidas alcohólicas al detal — certifica que el solicitante no tiene deuda contributiva sobre propiedad mueble con el CRIM."),
    text("The CRIM clearance proves municipal property-tax compliance; Hacienda treats it as a gate for the alcohol dealer license.", "La certificación del CRIM prueba el cumplimiento contributivo municipal; Hacienda la trata como un filtro para la licencia de traficante de alcohol."),
    text("Obtain the negative debt certification through the CRIM360 portal and attach it to the alcohol-license application.", "Obtén la certificación negativa de deuda en el portal CRIM360 y anéxala a la solicitud de licencia de alcohol."),
    text("A clean CRIM clearance lets the alcohol-license application proceed; unresolved CRIM debt blocks the license until paid.", "Una certificación del CRIM limpia deja avanzar la solicitud de licencia de alcohol; una deuda contributiva sin resolver bloquea la licencia hasta saldarla."),
  ], ["DOC_ALCOHOL_LICENSE"]),
  DOC_BACKGROUND_CHECK: concept("DOC_BACKGROUND_CHECK", [[condition("Q_ALCOHOL_SOLD", "Alcohol sales: Yes", "Venta de alcohol: Sí", true)]], [PR_GUIDANCE_SOURCES.alcoholReqs, PR_GUIDANCE_SOURCES.antecedentes], [
    text("Hacienda requires the criminal-record certificate as a prerequisite for the retail alcohol beverage license — the Policía de Puerto Rico issues the Certificado de Antecedentes Penales under Ley 254-1974.", "Hacienda exige el certificado de antecedentes penales como prerrequisito de la licencia de bebidas alcohólicas al detal — la Policía de Puerto Rico lo expide bajo la Ley 254-1974."),
    text("The criminal record certificate documents the applicant's history for the alcohol dealer license file.", "El certificado de antecedentes penales documenta el historial del solicitante para el expediente de la licencia de alcohol."),
    text("Apply for the Certificado de Antecedentes Penales through the official pr.gov portal (free online) and include it with the license application.", "Solicita el Certificado de Antecedentes Penales en el portal oficial de pr.gov (gratis en línea) e inclúyelo con la solicitud de licencia."),
    text("With the criminal record certificate on file, the background prerequisite is satisfied; Hacienda reviews the remaining license requirements.", "Con el certificado de antecedentes penales en el expediente, el prerrequisito de antecedentes queda satisfecho; Hacienda revisa los demás requisitos de la licencia."),
  ], ["DOC_ALCOHOL_LICENSE"]),
  DOC_EIN: concept("DOC_EIN", [[employee]], [PR_GUIDANCE_SOURCES.ein], [
    text("The IRS identifies a business by its Employer Identification Number (EIN). Employers need one for employment-tax reporting, and most registered entities need one as well.", "El IRS identifica a un negocio por su Número de Identificación Patronal (EIN). Los patronos lo necesitan para informar contribuciones sobre el empleo, y la mayoría de las entidades registradas también."),
    text("IRS confirmation is official evidence of the EIN assigned to the business, not the application for that number.", "La confirmación del IRS es evidencia oficial del EIN asignado al negocio, no la solicitud de ese número."),
    text("Prepare the EIN application, or upload IRS confirmation if already assigned. A new entity must be formed before it can apply for an EIN.", "Prepara la solicitud del EIN o sube la confirmación del IRS si ya fue asignado. Una entidad nueva tiene que estar constituida antes de solicitar el EIN."),
    text("The assigned EIN can identify the business on tax returns and later licensing applications. Do not substitute a draft for IRS confirmation.", "El EIN asignado identifica al negocio en planillas y solicitudes de licencias. Un borrador no sustituye la confirmación del IRS."),
  ]),
  DOC_SAM_REGISTRATION: concept("DOC_SAM_REGISTRATION", [
    [condition("Q_FEDERAL_CONTRACTS_GRANTS", "Plans to bid on federal contracts or apply for federal grants or awards", "Planea licitar contratos federales o solicitar fondos federales", true)],
    [condition("businessType", "Government contractor: construction", "Contratista del gobierno: construcción", "BT_CONSTRUCTION_GOVERNMENT_CONTRACTOR")],
    [condition("businessType", "Government contractor: IT", "Contratista del gobierno: tecnología", "BT_IT_GOVERNMENT_CONTRACTOR")],
    [condition("businessType", "Government contractor: professional services", "Contratista del gobierno: servicios profesionales", "BT_PROFESSIONAL_SERVICES_GOVERNMENT_CONTRACTOR")],
    [condition("businessType", "Government contractor: facilities", "Contratista del gobierno: facilidades", "BT_FACILITIES_GOVERNMENT_CONTRACTOR")],
  ], [PR_GUIDANCE_SOURCES.sam], [
    text("Businesses pursuing federal work must be registered in SAM.gov, the federal government's business registry. Registration is free.", "Los negocios que buscan trabajo con el gobierno federal tienen que estar registrados en SAM.gov, el registro federal de negocios. El registro es gratis."),
    text("The SAM.gov entity registration is the business's active record for federal contracting and awards; it must be renewed every 365 days to stay active.", "El registro de entidad en SAM.gov es el expediente activo del negocio para contratos y fondos federales; hay que renovarlo cada 365 días para mantenerlo activo."),
    text("Register the business free at sam.gov and keep the registration current; renew it annually before it expires.", "Registra el negocio gratis en sam.gov y mantén el registro al día; renuévalo cada año antes de que se venza."),
    text("Without an active SAM.gov registration the business cannot be awarded federal contracts or receive federal funds; an expired registration blocks awards.", "Sin un registro activo en SAM.gov el negocio no puede recibir contratos federales ni fondos federales; un registro vencido tranca las adjudicaciones."),
  ]),
  
  DOC_CONTRACTOR_LICENSE: concept("DOC_CONTRACTOR_LICENSE", [
    [condition("Q_OFFERS_CONSTRUCTION_SERVICES", "Offers construction, installation, repair, or contracting services to others", "Ofrece construcción, instalación, reparación o contratación a terceros", true)],
    [condition("businessType", "General contractor", "Contratista general", "BT_GENERAL_CONTRACTOR")],
    [condition("businessType", "Specialty trade contractor", "Contratista de oficio especializado", "BT_SPECIALTY_TRADE_CONTRACTOR")],
    [condition("businessType", "Construction government contractor", "Contratista de construcción del gobierno", "BT_CONSTRUCTION_GOVERNMENT_CONTRACTOR")],
  ], [PR_GUIDANCE_SOURCES.daco], [
    text("Businesses that offer construction, installation, repair, or contracting services on property they do not own need DACO contractor certification before advertising or submitting estimates.", "Los negocios que ofrecen construcción, instalación, reparación o contratación en propiedad que no es suya necesitan la certificación de contratista de DACO antes de anunciarse o someter estimados."),
    text("Manufacturing or textile-recycling alone does not trigger DACO contractor registration — only when the business also offers contracting services to others.", "Manufactura o reciclaje textil por sí solos no activan el registro de contratistas de DACO — solo cuando el negocio también ofrece servicios de contratación a terceros."),
    text("SmartPR prepares the official DACOUC01 application (page-1 fields) and a supporting-documents checklist for the filing package.", "SmartPR prepara la solicitud oficial DACOUC01 (campos de la página 1) y una lista de documentos de apoyo para el paquete de radicación."),
    text("Inscription is renewed annually under Ley 146-1995; keep the bond and DACO certification current.", "La inscripción se renueva anualmente bajo la Ley 146-1995; mantén la fianza y la certificación de DACO al día."),
  ]),
  DOC_MERCHANT_REGISTRATION: concept("DOC_MERCHANT_REGISTRATION", [[business]], [PR_GUIDANCE_SOURCES.merchant, PR_GUIDANCE_SOURCES.merchantLaw], [
    text("Puerto Rico's merchant-registration process identifies commercial locations and their sales-tax treatment with Hacienda.", "El registro de comerciantes de Puerto Rico identifica los locales comerciales y su tratamiento del IVU ante Hacienda."),
    text("The certificate records the merchant's location and whether it is an IVU withholding agent; it is not a business-use permit.", "El certificado identifica la localidad del comerciante y si es agente retenedor del IVU; no es un permiso de uso."),
    text("Review business, tax and location details for registration in SURI. Upload the issued Merchant Registration Certificate when available.", "Revisa los datos del negocio, contributivos y de localidad para registrarte en SURI. Sube el Certificado de Registro de Comerciante emitido."),
    text("The issued certificate documents the merchant registration for later filings; it does not replace location or activity-specific permits.", "El certificado emitido acredita el registro de comerciante en trámites posteriores; no sustituye permisos de uso ni licencias específicas."),
  ]),
  DOC_PERMISO_UNICO: concept("DOC_PERMISO_UNICO", [[condition("Q_PHYSICAL_LOCATION", "Nonresidential business location", "Local comercial no residencial", true)]], [PR_GUIDANCE_SOURCES.permiso], [
    text("Nonresidential business use requires the Permiso Único process, including review of permitted use and applicable operating licenses.", "El uso comercial no residencial requiere el trámite de Permiso Único y revisar el uso permitido y las licencias aplicables."),
    text("This is the operating-permit process for the proposed activity at the premises, not entity formation.", "Es el trámite de permiso para la actividad propuesta en el local, no la constitución de la entidad."),
    text("Check permitted use, assemble the property evidence and applicable license information, and complete the permit application in SBP.", "Verifica el uso permitido, reúne la evidencia de la propiedad y las licencias aplicables, y completa la solicitud en SBP."),
    text("An issued permit covers the approved use at that location, subject to its terms. Preparing the package does not authorize operation.", "El permiso emitido cubre el uso aprobado en esa ubicación y sus condiciones. Preparar el paquete no autoriza operar."),
  ]),
  DOC_PATENTE_MUNICIPAL: concept("DOC_PATENTE_MUNICIPAL", [[municipality, business]], [PR_GUIDANCE_SOURCES.codigoMunicipal], [
    text("The municipal patent is {municipality}'s tax on the volume of business from commercial activity, established under the Código Municipal de Puerto Rico (Law 107-2020, Arts. 7.200–7.207).", "La patente municipal es el impuesto de {municipality} sobre el volumen de negocios de la actividad comercial, establecido en el Código Municipal de Puerto Rico (Ley 107-2020, Arts. 7.200–7.207)."),
    text("The patent is a municipal business-tax obligation, separate from permission to use the premises.", "La patente es una obligación contributiva municipal, distinta del permiso para usar el local."),
    text("For a new business, file the provisional patent return with {municipality}; an existing operation reviews its volume-of-business filing instead. Confirm the exact forms and deadlines with the municipal finance office, since they vary by municipal ordinance.", "Para un negocio nuevo, radica la planilla de patente provisional en {municipality}; una operación existente revisa su declaración de volumen de negocios. Confirma los formularios y fechas límite con la oficina de finanzas municipal, ya que varían por ordenanza."),
    text("The filing establishes the municipal tax record used for subsequent volume-of-business reporting and patent payments; operating without it risks municipal penalties.", "La radicación establece el expediente contributivo municipal para futuras declaraciones de volumen de negocios y pagos de patente; operar sin ella expone a penalidades municipales."),
  ]),
  DOC_LEASE_AGREEMENT: concept("DOC_LEASE_AGREEMENT", [[condition("Q_EXISTING_LEASE", "Leased premises confirmed", "Local arrendado confirmado", true), municipality]], [PR_GUIDANCE_SOURCES.propertyEvidence], [
    text("When the premises are leased, the lease agreement is the supporting evidence of site control for the permit filing in {municipality} — it documents the business's right to occupy the rented space.", "Cuando el local es arrendado, el contrato de arrendamiento es la evidencia de control del predio para el expediente de permisos en {municipality} — documenta el derecho del negocio a ocupar el espacio rentado."),
    text("This is the agreement with the landlord, not a government-issued permit or proof that the proposed use is approved.", "Es el acuerdo con el arrendador, no un permiso gubernamental ni prueba de que el uso propuesto esté aprobado."),
    text("Upload the signed lease and check that the tenant and premises match the permit application.", "Sube el contrato firmado y verifica que el arrendatario y el local coincidan con la solicitud del permiso."),
    text("The lease supports the property's occupancy evidence in the permit package; the authority must still approve the proposed use.", "El contrato respalda la evidencia de ocupación del inmueble en el expediente; la autoridad todavía debe aprobar el uso propuesto."),
  ]),
  DOC_ARTICLES_ORGANIZATION: concept("DOC_ARTICLES_ORGANIZATION", [[condition("entityType", "Entity: Puerto Rico LLC", "Entidad: LLC de Puerto Rico", "limited_liability_company")]], [PR_GUIDANCE_SOURCES.entity], [
    text("Selecting an LLC structure does not create the company. Puerto Rico forms an LLC through a Certificate of Organization.", "Elegir la estructura LLC no crea la compañía. Puerto Rico constituye una LLC mediante un Certificado de Organización."),
    text("The formation document establishes the limited liability company with the Department of State.", "El documento de constitución establece la compañía de responsabilidad limitada ante el Departamento de Estado."),
    text("Complete the Certificate of Organization with the company, address and resident-agent details. If already formed, provide the existing formation evidence.", "Completa el Certificado de Organización con los datos de compañía, dirección y agente residente. Si ya está constituida, aporta la evidencia existente."),
    text("After formation is accepted, use the LLC's legal identity for EIN, tax and licensing applications; a completed draft is not formation.", "Tras aceptarse la constitución, usa la identidad legal de la LLC en solicitudes de EIN, contribuciones y licencias; un borrador no constituye la entidad."),
  ]),
  DOC_WORKERS_COMP: concept("DOC_WORKERS_COMP", [[employee]], [PR_GUIDANCE_SOURCES.cfse], [
    text("Hiring workers creates employer responsibilities for workplace-injury coverage through CFSE, subject to the applicable coverage rules.", "Contratar trabajadores conlleva responsabilidades patronales de cobertura por lesiones ocupacionales mediante la CFSE, según las reglas aplicables."),
    text("The CFSE policy documents workers' compensation coverage for the reported workforce, risks and locations.", "La póliza de la CFSE documenta cobertura por accidentes del trabajo para la plantilla, riesgos y localidades informados."),
    text("Provide payroll, work-risk and location information for the CFSE policy process; upload issued coverage evidence when available.", "Aporta nómina, riesgos laborales y localidades para el trámite de póliza de la CFSE; sube la evidencia de cobertura emitida."),
    text("Issued coverage supports employer readiness. Payroll reporting and premium obligations continue; an application alone is not insurance.", "La cobertura emitida respalda la preparación patronal. Continúan las obligaciones de nómina y primas; una solicitud sola no es un seguro."),
  ]),
  DOC_DTRH_EMPLOYER_REG: concept("DOC_DTRH_EMPLOYER_REG", [[employee]], [PR_GUIDANCE_SOURCES.dtrh], [
    text("Employers in Puerto Rico must register with the Department of Labor and Human Resources (DTRH) for unemployment and disability insurance once they hire workers.", "Los patronos en Puerto Rico deben registrarse en el Departamento del Trabajo y Recursos Humanos (DTRH) para el seguro por desempleo e incapacidad al contratar trabajadores."),
    text("The DTRH employer registration is the business's record as an employer for unemployment and disability insurance — separate from CFSE workers' compensation coverage.", "El registro patronal del DTRH es el expediente del negocio como patrono para el seguro por desempleo e incapacidad — aparte de la póliza de la CFSE por accidentes del trabajo."),
    text("Register as an employer through the DTRH employer portal and keep the assigned employer number for payroll filings.", "Regístrate como patrono en el portal de patronos del DTRH y conserva el número patronal asignado para las radicaciones de nómina."),
    text("An active DTRH employer registration lets the business report and pay unemployment and disability contributions; hiring without registering risks penalties.", "Un registro patronal activo del DTRH permite informar y pagar las aportaciones por desempleo e incapacidad; contratar sin registrarse expone a penalidades."),
  ]),



  DOC_HEALTH_PERMIT: concept("DOC_HEALTH_PERMIT", [[condition("Q_FOOD_PREPARED", "Food prepared on site", "Alimentos preparados en el local", true)], [condition("Q_FOOD_SOLD", "Food sold on site", "Alimentos vendidos en el local", true)]], [PR_GUIDANCE_SOURCES.health], [
    text("Establishments that prepare or sell food are subject to sanitary inspection under environmental health regulation before they may operate.", "Los establecimientos que preparan o venden alimentos están sujetos a inspección sanitaria bajo la reglamentación de salud ambiental antes de operar."),
    text("The sanitary/health permit documents that the premises passed inspection for food-handling and public-health conditions.", "El permiso sanitario acredita que el local aprobó la inspección de manejo de alimentos y condiciones de salud pública."),
    text("Prepare the premises for a Departamento de Salud sanitary inspection and submit the permit application for the food-handling activity.", "Prepara el local para la inspección sanitaria del Departamento de Salud y presenta la solicitud del permiso para la actividad de manejo de alimentos."),
    text("An issued sanitary permit authorizes the inspected food-handling activity at that location, subject to its conditions and renewal.", "El permiso sanitario emitido autoriza la actividad de manejo de alimentos inspeccionada en ese local, sujeto a sus condiciones y renovación."),
  ]),
  DOC_FIRE_CERT: concept("DOC_FIRE_CERT", [[condition("Q_FOOD_PREPARED", "Food prepared on site", "Alimentos preparados en el local", true)]], [PR_GUIDANCE_SOURCES.fire], [
    // REG-GUIDE-FIRE-GENERAL-001 (2026-09-17 QA): this concept fires for
    // restaurants, manufacturers, warehouses, and other commercial or
    // industrial premises — the lead sentence must not define fire
    // certification as a food-service thing. Food preparation and public
    // occupancy are examples of what the inspection covers, not its scope.
    text("Commercial and industrial premises require a fire-safety inspection before Cuerpo de Bomberos certifies the space. The inspection covers the occupancy, equipment, and stored materials — for example food-preparation areas or spaces with public occupancy.", "Los locales comerciales e industriales requieren inspección de seguridad contra incendios antes de la certificación del Cuerpo de Bomberos. La inspección cubre la ocupación, el equipo y los materiales almacenados — por ejemplo, áreas de preparación de alimentos o espacios con ocupación pública."),
    text("The fire certification documents that the premises passed fire-code inspection for its occupancy and equipment, not general business compliance.", "El certificado de bomberos acredita que el local aprobó la inspección del código contra incendios para su ocupación y equipo, no el cumplimiento general del negocio."),
    text("Schedule the Cuerpo de Bomberos inspection for the premises and correct any noted deficiencies before the certificate is issued.", "Coordina la inspección del Cuerpo de Bomberos para el local y corrige las deficiencias señaladas antes de que se emita el certificado."),
    text("The issued fire certificate is required supporting evidence for the Permiso Único package; an inspection request alone is not certification.", "El certificado de bomberos emitido es evidencia requerida para el expediente del Permiso Único; solicitar la inspección no equivale a estar certificado."),
  ]),
  DOC_CFPM: concept("DOC_CFPM", [[condition("Q_FOOD_PREPARED", "Food prepared on site", "Alimentos preparados en el local", true)]], [PR_GUIDANCE_SOURCES.cfpm], [
    text("Establishments that prepare food must have a certified food protection manager on staff under Departamento de Salud regulation.", "Los establecimientos que preparan alimentos deben contar con un manejador de alimentos certificado según la reglamentación del Departamento de Salud."),
    text("The certified food protection manager documents that a specific staff member completed food-safety training as a food handler, not that the premises itself passed inspection.", "El manejador de alimentos certificado acredita que un miembro específico del personal completó adiestramiento de seguridad alimentaria, no que el local aprobó inspección."),
    text("Enroll the designated staff member as a certified food protection manager / food handler in an accredited course and keep the certification on file.", "Inscribe al empleado designado como manejador de alimentos certificado en un curso acreditado y conserva la certificación en el expediente."),
    text("A completed food protection manager certification qualifies that food handler to oversee food handling; it must stay current under the program's renewal terms.", "La certificación de manejador de alimentos completada habilita a ese empleado para supervisar el manejo de alimentos; debe mantenerse vigente según los términos de renovación."),
  ]),

  DOC_NOISE_VARIANCE: concept("DOC_NOISE_VARIANCE", [[municipality]], [PR_GUIDANCE_SOURCES.noise], [
    text("{municipality} designates zones where activities generating elevated noise need a noise-control endorsement before operating there.", "{municipality} designa zonas donde las actividades que generan niveles elevados de ruido necesitan un endoso de control de ruido antes de operar."),
    text("The noise endorsement documents that the activity's expected noise levels were reviewed for the zone, not the activity's other licenses.", "El endoso de ruido acredita que se revisaron los niveles de ruido esperados de la actividad para la zona; no cubre otras licencias de la actividad."),
    text("Describe the activity's noise sources and expected levels, and request the noise-control endorsement through {municipality}'s permits office.", "Describe las fuentes de ruido de la actividad y los niveles esperados, y solicita el endoso de control de ruido en la oficina de permisos de {municipality}."),
    text("An issued endorsement authorizes the reviewed noise levels for that activity and zone, subject to its conditions and any complaints.", "El endoso emitido autoriza los niveles de ruido revisados para esa actividad y zona, sujeto a sus condiciones y a las quejas que se reciban."),
  ]),

  DOC_LUMA_INTERCONNECTION: concept("DOC_LUMA_INTERCONNECTION", [[condition("Q_RENEWABLE_INSTALL", "Renewable energy system to be installed", "Instalación de sistema de energía renovable", true)]], [PR_GUIDANCE_SOURCES.luma], [
    text("A grid-connected solar system must be registered with LUMA Energy before it can legally operate. LUMA's interconnection review covers the system's technical requirements for parallel operation with the grid.", "Un sistema solar conectado a la red tiene que estar registrado con LUMA Energy antes de poder operar legalmente. La revisión de interconexión de LUMA cubre los requisitos técnicos para operar en paralelo con la red."),
    text("The interconnection registration is LUMA's record of the distributed generation system and its approval to connect, not the OGPe construction permit and not permission to operate.", "El registro de interconexión es el expediente de LUMA del sistema de generación distribuida y su aprobación para conectarse; no es el permiso de construcción de OGPe ni el permiso para operar."),
    text("Complete LUMA's interconnection registration with the system specifications and installer information. If the project needs an OGPe construction permit, finish OGPe first — LUMA requires the approved OGPe use permit before it processes the interconnection.", "Completa el registro de interconexión de LUMA con las especificaciones del sistema y la información del instalador. Si el proyecto necesita permiso de construcción de OGPe, termina OGPe primero — LUMA exige el permiso de uso aprobado de OGPe antes de tramitar la interconexión."),
    text("LUMA's interconnection approval authorizes the system to connect; the system still needs LUMA's Permission to Operate before it is switched on.", "La aprobación de interconexión de LUMA autoriza conectar el sistema; el sistema todavía necesita el Permiso para Operar de LUMA antes de encenderse."),
  ]),
  DOC_NET_METERING_AGREEMENT: concept("DOC_NET_METERING_AGREEMENT", [[condition("Q_RENEWABLE_INSTALL", "Renewable energy system to be installed", "Instalación de sistema de energía renovable", true)]], [PR_GUIDANCE_SOURCES.netMetering], [
    text("Commercial solar systems that export surplus energy to the grid operate under LUMA's interconnection and net metering agreement, which sets the metering and compensation terms.", "Los sistemas solares comerciales que exportan el excedente de energía a la red operan bajo el acuerdo de interconexión y medición neta de LUMA, que establece los términos de medición y compensación."),
    text("The net metering agreement documents the terms for parallel operation and exported-energy metering; it is not the interconnection registration itself and not permission to operate.", "El acuerdo de medición neta documenta los términos de operación en paralelo y medición de la energía exportada; no es el registro de interconexión ni el permiso para operar."),
    text("Execute LUMA's interconnection / net metering agreement for the commercial customer account tied to the installation address.", "Firma el acuerdo de interconexión y medición neta de LUMA para la cuenta comercial del cliente atada a la dirección de la instalación."),
    text("A countersigned agreement locks in the net metering terms for the system; keep it with the interconnection file until LUMA grants Permission to Operate.", "Un acuerdo firmado por ambas partes fija los términos de medición neta del sistema; consérvalo con el expediente de interconexión hasta que LUMA otorgue el Permiso para Operar."),
  ]),
  DOC_OGPE_CONSTRUCTION_PERMIT: concept("DOC_OGPE_CONSTRUCTION_PERMIT", [[condition("Q_SOLAR_MOUNTING", "Ground-mounted solar system", "Sistema solar instalado en el suelo", "Ground-mounted")], [condition("Q_SOLAR_SIZE", "System over 1 MW", "Sistema de más de 1 MW", "Over 1 MW")]], [PR_GUIDANCE_SOURCES.ogpeConstruction], [
    // REG-GUIDE-SOLAR-CONSTRUCTION-001 (2026-09-16): this document is the
    // general OGPe construction permit — it fires for new construction,
    // expansions, and structural work, not only solar. The text stays
    // construction-first; the solar exemption nuance is kept as one
    // sentence so solar projects do not lose validated knowledge.
    text("New construction, expansions, and structural work need an OGPe construction permit before work begins, under Puerto Rico's building codes (Ley 161-2009). For solar projects: photovoltaic systems larger than 1 MW, or not installed on the roof of an existing structure, go through OGPe construction permitting before LUMA — rooftop systems of 1 MW or less on existing structures are exempt from OGPe construction and use permits.", "La construcción nueva, las ampliaciones y los trabajos estructurales necesitan un permiso de construcción de OGPe antes de empezar, bajo los códigos de construcción de Puerto Rico (Ley 161-2009). Para proyectos solares: los sistemas fotovoltaicos de más de 1 MW, o que no se instalen en el techo de una estructura existente, pasan por los permisos de construcción de OGPe antes de LUMA; los sistemas en techo de 1 MW o menos en estructuras existentes están exentos de los permisos de construcción y uso de OGPe."),
    text("The OGPe construction permit authorizes the project's construction under the building and energy codes. It is separate from the use permit that follows, which is what authorizes the business to operate.", "El permiso de construcción de OGPe autoriza la construcción del proyecto bajo los códigos de construcción y energía. Es independiente del permiso de uso que viene después, que es lo que autoriza a operar el negocio."),
    text("File the construction permit application through OGPe's Single Business Portal with the project plans and structural documentation.", "Radica la solicitud del permiso de construcción en el Portal Único de OGPe con los planos del proyecto y la documentación estructural."),
    text("An issued construction permit lets the project build; keep it with the project file — the approved use permit that follows is what authorizes operation.", "Un permiso de construcción emitido permite construir el proyecto; guárdalo en el expediente — el permiso de uso aprobado que sigue es lo que autoriza la operación."),
  ]),
};
