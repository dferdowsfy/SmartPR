import type { GuidanceConcept, GuidanceCondition, GuidanceSource, LocalizedText } from "./model";

const text = (en: string, es: string): LocalizedText => ({ en, es });
const condition = (key: GuidanceCondition["key"], en: string, es: string, equals?: string | boolean): GuidanceCondition => ({ key, label: text(en, es), ...(equals === undefined ? {} : { equals }) });
const source = (id: string, agency: string, citation: string, url: string, supports: string): GuidanceSource => ({ id, agency, citation, url, supports, lastVerified: "2026-09-03", sourceVersion: "public-guidance-2026-09-03" });

export const PR_GUIDANCE_SOURCES = {
  alcohol: source("SRC_GUIDANCE_ALCOHOL", "Departamento de Hacienda", "Código de Rentas Internas de 2011 (Ley 1-2011), Subtítulo E; licensing FAQs", "https://hacienda.pr.gov/sites/default/files/codigo_de_rentas_internas.pdf", "Subtitle E, sections 5050.01–5050.18: licensing alcoholic-beverage dealers and limits on licensed sales."),
  ein: source("SRC_GUIDANCE_EIN", "Internal Revenue Service", "Employer identification number — who needs an EIN; confirmation", "https://www.irs.gov/businesses/employer-identification-number", "Employers need an EIN; IRS confirmation documents the assigned number; form the legal entity before applying."),
  merchant: source("SRC_GUIDANCE_MERCHANT", "Departamento de Hacienda", "SURI — merchant location registration and certificates", "https://hacienda.pr.gov/transacciones-que-puedes-realizar-traves-de-suri", "SURI registers merchant locations and issues the Merchant Registration Certificate electronically."),
  merchantLaw: source("SRC_GUIDANCE_MERCHANT_RULE", "Departamento de Hacienda", "Regulation 8942 — Merchant Registration Certificate", "https://hacienda.pr.gov/sites/default/files/8942.pdf", "Merchant registration identifies each commercial location and whether the merchant is an IVU withholding agent."),
  permiso: source("SRC_GUIDANCE_PU", "OGPe", "Nonresidential use — permits for a business or activity", "https://www.permisos.pr.gov/", "Nonresidential uses require the Permiso Único process; check permitted use and applicable special licenses in SBP."),
  codigoMunicipal: source("SRC_GUIDANCE_CODIGO_MUNICIPAL", "Oficina de Gerencia y Presupuesto (OGP)", "Código Municipal de Puerto Rico — Ley 107-2020, según enmendada", "https://docs.pr.gov/files/JP-Junta%20de%20Planificacion/Leyes/Codigo-Municipal-de-Puerto-Rico-Ley-107-2020.pdf", "Ley 107-2020, Arts. 7.200–7.207: la patente municipal grava el volumen de negocios de la actividad comercial en el municipio."),
  // REG-GUIDE-AMBULANT-001 (2026-10-06 QA, live S454): the Municipal
  // Ambulant-Business License card rendered the unvalidated-description
  // placeholder on a live Toa Baja food-truck filing while its own citation
  // (Ley 81-1991, Art. 20.003) is a genuine statute. Verified 2026-10-06
  // (LexJuris compiled Ley 81-1991 text; 21 L.P.R.A. § 4952): municipalities
  // regulate the location and operation of ambulant businesses within their
  // territorial limits and may issue/deny/suspend/revoke/amend/modify the
  // licenses for any ambulant business; each license type is valid for up to
  // one year.
  ambulant: source("SRC_GUIDANCE_AMBULANT", "Legislatura de Puerto Rico", "Ley 81-1991, Artículo 20.003 — Reglamentación de Negocios Ambulantes (21 L.P.R.A. § 4952)", "https://agencias.pr.gov/agencias/JACL/Documents/LeyesReglamentos/Ley%20de%20Municipios%20Autonomos.pdf", "Municipalities regulate the location and operation of ambulant businesses within their territorial limits and may issue, deny, suspend, revoke, amend or modify the licenses required for any ambulant business; each license type is valid for up to one year."),
  // REG-GUIDE-USEDOIL-001 (2026-10-06 QA, live S467): the DRNA Used-Oil
  // Generator Identification and EPA/DRNA Hazardous-Waste Generator ID cards
  // rendered the unvalidated-description placeholder on a live Toa Baja
  // auto-repair filing while citing genuine statutes. Ley 172-1996
  // ("Ley para el Manejo Adecuado de Aceite Usado en Puerto Rico") — verified
  // 2026-10-06 via the OGP-compiled statute PDF — prohibits dumping used oil
  // on land, in sewers/septics, or in water bodies and requires its proper
  // collection, recovery and disposal (Reglamento 5717, Cap. VII).
  usedOil: source("SRC_GUIDANCE_USEDOIL", "Departamento de Recursos Naturales y Ambientales (DRNA)", "Ley Núm. 172-1996 — Ley para el Manejo Adecuado de Aceite Usado en Puerto Rico; Reglamento 5717, Cap. VII", "https://bvirtualogp.pr.gov/ogp/Bvirtual/leyesreferencia/PDF/Ambientales/172-1996/172-1996.pdf", "Art. 16 prohibitions: no person may discharge, dump, spill or deposit used oil on land, into sanitary or storm sewers, septic tanks, surface or ground waters, or marine waters; collection, storage, use and disposal must follow the applicable laws and regulations."),
  // REG-GUIDE-USEDOIL-001 (2026-10-06 QA, live S467): the hazardous-waste
  // generator card rendered the "confirm with the agency" placeholder while
  // citing a genuine statute pair. EPA's hazardous-waste generator regulatory
  // summary — verified 200 OK 2026-10-06 — documents the RCRA generator
  // obligations; Ley 70-1992 is the PR solid/hazardous-waste framework the
  // DRNA administers locally.
  hazmat: source("SRC_GUIDANCE_HAZMAT", "U.S. Environmental Protection Agency", "Hazardous waste generators — 40 CFR Part 262; Ley Núm. 70-1992 (Puerto Rico)", "https://www.epa.gov/hwgenerators/hazardous-waste-generator-regulatory-summary", "EPA's regulatory summary of hazardous-waste generator requirements under RCRA: identification numbers, accumulation, manifesting and recordkeeping by generator category."),
  ogpCarta: source("SRC_GUIDANCE_OGP_CC_002_2022", "Oficina de Gerencia y Presupuesto (OGP)", "Carta Circular 002-2022 — disposiciones sobre cumplimiento contributivo municipal", "https://docs.pr.gov/files/OGP/Website_OGP/CartasCirculares/CC2022/CC-002-2022.pdf", "La Carta Circular 002-2022 de OGP establece las disposiciones sobre la certificación de cumplimiento contributivo municipal."),
  propertyEvidence: source("SRC_GUIDANCE_PROPERTY_EVIDENCE", "OGPe", "Single Business Portal — evidencia de la propiedad en las solicitudes de permiso", "https://www.permisos.pr.gov/", "La evidencia de control del predio (escritura o contrato de arrendamiento) forma parte del expediente de permisos."),
  // REG-GUIDE-DTRH-SOURCE-001 (2026-10-04 QA): a live filing audit
  // (S412–S414, 09:00 cycle) showed the DTRH employer-registration card's
  // SOURCE as a patronos help-page URL with no statutory basis, while the
  // KB document itself already cites the statutes. The source citation now
  // names the statutes (the help-page URL stays as the filing channel).
  dtrh: source("SRC_GUIDANCE_DTRH", "Departamento del Trabajo y Recursos Humanos", "Registro patronal — Ley 74-1956 (Ley de Seguridad de Empleo, seguro por desempleo) y Ley 139-1968 (seguro por incapacidad no ocupacional)", "https://patronos.trabajo.pr.gov/patronos/Help/Help_ES/radicacindesolicituddenmeropatronalparadesempleoeincapacidad.htm", "El portal de patronos del DTRH procesa la solicitud del número patronal para el seguro por desempleo e incapacidad."),
  entityLlc: source("SRC_GUIDANCE_ENTITY_LLC", "Departamento de Estado", "LLCs — formation by Certificate of Organization", "https://www.estado.pr.gov/corporaciones", "An LLC is created through a Certificate of Organization filed with the Department of State."),
  // REG-GUIDE-ENTITY-001 (2026-09-17 QA): the Certificate of Incorporation
  // card rendered the LLC citation ("LLC formation by Certificate of
  // Organization") because both legal forms shared one source. Corporations
  // and LLCs now cite their own formation source.
  entityCorp: source("SRC_GUIDANCE_ENTITY_CORP", "Departamento de Estado", "Corporations — incorporation by Certificate of Incorporation", "https://www.estado.pr.gov/corporaciones", "A corporation comes into existence when the Department of State accepts its Certificate of Incorporation (Ley 164-2009)."),
  // REG-FOREIGN-AUTH-001 (2026-09-27 QA): foreign corporations doing business
  // in PR need the Certificate of Authorization (Ley 164-2009 Art. 13.01),
  // not a new incorporation.
  entityForeign: source("SRC_GUIDANCE_ENTITY_FOREIGN", "Departamento de Estado", "Foreign corporations — Certificate of Authorization to do business in PR", "https://www.estado.pr.gov/formularios-para-corporaciones", "A corporation formed outside Puerto Rico obtains a Certificate of Authorization from the Department of State before doing business in Puerto Rico (Ley 164-2009, Art. 13.01)."),
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
  // REG-TOBACCO-RETAIL-001 (2026-09-28 QA): source for the Retail Cigarette
  // License and its prerequisite cards. Hacienda's official
  // "Requisitos para cada tipo de Licencia de Rentas Internas" page
  // (verified 2026-09-28 at hacienda.pr.gov/node/1178) lists the
  // "Licencia de Detallista / Mayorista de Cigarrillos" — the retail
  // cigarette/tobacco dealer license under Sec. 3050.01 of the Código de
  // Rentas Internas de 2011 — with the ASUME certification, the CRIM
  // movable-property debt certification, the criminal-record certificate,
  // and the sales projection (proyección o volumen de ventas) among its
  // prerequisites.
  tobaccoReqs: source("SRC_GUIDANCE_TOBACCO_REQS", "Departamento de Hacienda", "Requisitos para cada tipo de licencia de rentas internas — Licencia de Detallista / Mayorista de Cigarrillos", "https://hacienda.pr.gov/node/1178", "Hacienda's official internal-revenue license requirements list the retail cigarette dealer license (Licencia de Detallista de Cigarrillos) with the ASUME certification, the CRIM debt certification, the criminal-record certificate, and the sales projection among its prerequisites."),
  // REG-GUIDE-TAX-COMPLIANCE-001 (2026-09-21 QA): source for the Hacienda
  // Tax Filing & Debt Compliance evidence card. The requirement is
  // established by the founder judgment (§29.2, 2026-09-16, settled):
  // "tax filing/debt compliance" is one of Hacienda's official prerequisites
  // for the Licencia de Traficante al Detalle de Bebidas Alcohólicas.
  taxCompliance: source("SRC_GUIDANCE_HACIENDA_TAX_COMPLIANCE", "Departamento de Hacienda", "Requisitos para cada tipo de licencia de rentas internas — Licencia de Traficante al Detalle de Bebidas Alcohólicas: evidencia de radicación de planillas y cumplimiento de deudas contributivas", "https://hacienda.pr.gov/comerciantes/licencias-de-rentas-internas/requisitos-para-cada-tipo-de-licencia-de-rentas-internas", "Hacienda's official internal-revenue license requirements list tax filing and debt compliance among the prerequisites for the retail alcoholic-beverage dealer license (founder judgment §29.2, 2026-09-16)."),
  // REG-GUIDE-ALCOHOL-SALES-001 (2026-09-21 QA): source for the Alcohol
  // Sales Projection card. The requirement is established by the founder
  // judgment (§29.2, 2026-09-16, settled): "projected sales" is one of
  // Hacienda's official prerequisites for the Licencia de Traficante al
  // Detalle de Bebidas Alcohólicas.
  alcoholSales: source("SRC_GUIDANCE_ALCOHOL_SALES_PROJECTION", "Departamento de Hacienda", "Requisitos para cada tipo de licencia de rentas internas — Licencia de Traficante al Detalle de Bebidas Alcohólicas: proyección del volumen de ventas", "https://hacienda.pr.gov/comerciantes/licencias-de-rentas-internas/requisitos-para-cada-tipo-de-licencia-de-rentas-internas", "Hacienda's official internal-revenue license requirements list projected alcohol sales among the prerequisites for the retail alcoholic-beverage dealer license (founder judgment §29.2, 2026-09-16)."),
  antecedentes: source("SRC_GUIDANCE_ANTECEDENTES", "Policía de Puerto Rico", "Ley 254-1974, Art. 1 (34 L.P.R.A. § 1725)", "https://bvirtualogp.pr.gov/ogp/Bvirtual/leyesreferencia/PDF/Polic%C3%ADa/254-1974/254-1974.pdf", "Authorizes the Puerto Rico Police to issue the Certificado de Antecedentes Penales."),
  // REG-GUIDE-VEHICLE-001 (2026-09-17 QA): DOC_VEHICLE_REGISTRATION cards
  // were rendering the unvalidated-description placeholder; the document
  // itself cites Law 22-2000 Art. 23.01 at statute confidence.
  dtop: source("SRC_GUIDANCE_DTOP", "Departamento de Transportación y Obras Públicas (DTOP)", "Ley 22-2000, Art. 23.01 — vehicle registration and annual marbete", "https://dtop.pr.gov", "DTOP registers vehicles and issues the annual marbete; vehicle registrations, renewals, and forms are handled through CESCO (cesco.pr.gov)."),
  // REG-GUIDE-WITHHOLDING-001 (2026-09-17 QA): the
  // DOC_HACIENDA_EMPLOYER_WITHHOLDING card rendered the
  // unvalidated-description placeholder on a Bayamón contractor filing.
  // REG-GUIDE-WITHHOLDING-SOURCE-001 (2026-10-04 QA): a live filing audit
  // (S412–S414, 09:00 cycle) showed the Hacienda employer-withholding
  // card's SOURCE as plain prose ("Employers must register the withholding
  // account in SURI") with no statutory basis. The duty to withhold on
  // wages is imposed by Sección 1062.01(b) of the 2011 PR Internal Revenue
  // Code (verified against Hacienda's Boletín Informativo 14-03). The
  // citation now names the statute; the SURI URL stays as the filing channel.
  withholding: source("SRC_GUIDANCE_WITHHOLDING", "Departamento de Hacienda", "Retención patronal — Código de Rentas Internas de Puerto Rico de 2011 (Ley 1-2011), Sección 1062.01(b): todo patrono debe deducir y retener la contribución sobre ingresos de los salarios; la cuenta de retención se registra y maneja en SURI", "https://hacienda.pr.gov/transacciones-que-puedes-realizar-traves-de-suri", "SURI is Hacienda's portal for employer tax transactions, including employer withholding registration, withholding deposits, and payroll filings."),
  // REG-GUIDE-OUTDOOR-001 (2026-09-20 QA): the San Juan primary source for
  // outdoor seating was verified verbatim 2026-09-20 (Código de Orden Público,
  // Art. 2.301 — cafés al aire libre on sidewalks/public spaces require the
  // municipality's authorization). lastVerified is set explicitly: the
  // shared source() helper stamps 2026-09-03, which would be dishonest here.
  outdoorSeating: {
    id: "SRC_GUIDANCE_OUTDOOR_SEATING",
    agency: "Municipal Government",
    citation: "Código de Orden Público del Municipio de San Juan, Art. 2.301 (Espacios Públicos) — cafés al aire libre en aceras y espacios públicos requieren la autorización del Municipio",
    url: "https://www.sanjuanciudadpatria.com/wp-content/uploads/2022/10/1-ORD.-2-Serie-2020-21-Nuevo-Co%CC%81digo-de-Orden-Pu%CC%81blico.pdf",
    lastVerified: "2026-09-20",
    sourceVersion: "public-guidance-2026-09-20",
    supports: "Art. 2.301 verified verbatim: los cafés al aire libre, bares o cualquier otra operación de restaurantes en aceras y espacios públicos requerirán la autorización del Municipio — verificado para San Juan; en otros municipios aplica la ordenanza municipal correspondiente.",
  },
  // REG-GUIDE-SIGN-001 (2026-09-20 QA): the Sign / Rótulo Permit card
  // rendered the unvalidated-description placeholder on live Guaynabo,
  // San Juan, and Carolina filings. The document cites Ley 355-1999
  // (Ley Uniforme de Rótulos y Anuncios), Art. 29 (9 L.P.R.A. § 56b) at
  // statute confidence; the municipality is the issuing office (per the
  // document's own agency note) and signage is handled via the OGPe
  // Permiso Único or the municipality depending on location (per the
  // document's download note).
  signRotulo: source("SRC_GUIDANCE_SIGN_ROTULO", "Municipal Government", "Ley 355-1999 (Ley Uniforme de Rótulos y Anuncios), Art. 29 (9 L.P.R.A. § 56b) — municipal sign/rótulo authorization", "https://www.permisos.pr.gov/", "Exterior commercial signage (rótulos) requires the municipality's authorization under the Uniform Sign and Advertisement Law; the issuing office depends on the municipality, and signage is handled via the OGPe Permiso Único or the municipality depending on location."),
  // REG-GUIDE-ANNUAL-001 (2026-09-20 QA): the Annual Report / Annual Fee
  // card rendered the unvalidated-description placeholder on a live
  // Carolina gym filing. The document cites Ley 164-2009, Arts. 15.01(A)
  // y 21.03(C) at statute confidence; the April 15 deadline and the $150
  // amount are verified against Dept. of State material (Art. 15.01(A):
  // corporations file the Informe Anual by April 15; Art. 21.03(C): LLCs
  // pay the annual fee with basic company info).
  annualReport: source("SRC_GUIDANCE_ANNUAL_REPORT", "Departamento de Estado", "Ley 164-2009, Arts. 15.01(A) y 21.03(C) — informe anual (corps) / anualidad (LLC), vence 15 de abril", "https://www.estado.pr.gov/", "Corporations file the Informe Anual with the Department of State on or before April 15 each year (Art. 15.01(A)); LLCs pay the $150 annual fee with basic company information (Art. 21.03(C))."),
  // REG-GUIDE-TRANSPORT-001 (2026-09-18 QA): DOC_TRANSPORT_PERMIT cards were
  // rendering the unvalidated-description placeholder; the document itself
  // cites Law 109-1962 / NTSP Regulation 9156 §10.02 at statute confidence.
  ntsp: source("SRC_GUIDANCE_NTSP", "Negociado de Transporte y Otros Servicios Públicos (NTSP)", "Ley 109-1962; Reglamento 9156 §10.02 — franquicia de Porteador por Contrato", "https://ntsp.pr.gov/", "The NTSP franchises for-hire carriers (Porteador por Contrato) under Law 109-1962; Regulation 9156 §10.02 sets the franchise requirements. Many filings are processed via renovacionesonline.com."),
  // REG-GUIDE-AGRI-001 (2026-09-18 QA): DOC_AGRICULTURE_REGISTRATION cards
  // were rendering the unvalidated-description placeholder; the document
  // cites Ley 60-2019 (Código de Incentivos) at statute confidence.
  agricultura: source("SRC_GUIDANCE_AGRICULTURA", "Departamento de Agricultura", "Ley 60-2019 (Código de Incentivos) — Certificación de Agricultor Bona Fide", "https://docs.pr.gov/files/Agricultura/Bonafide/Solicitud%20agricultor%20bonafide%20para%20individuo.pdf", "The Incentives Code provides for the Secretary of Agriculture's Certificación de Agricultor Bona Fide, valid 4 years, issued through the Department of Agriculture's regional offices."),
  // REG-GUIDE-TOURISM-001 (2026-09-18 QA): the PRTC innkeeper registration
  // and room-tax return cards rendered the unvalidated-description
  // placeholder (flagged live 2026-09-18, S42). The documents cite Ley
  // 272-2003 at statute confidence; the concept content below is grounded in
  // that basis plus the founder-settled §29.4 facts (register as innkeeper /
  // hostelero, obtain the Innkeeper ID, collect the room-occupancy tax,
  // file the monthly return by the 10th). No invented procedure.
  tourism: source("SRC_GUIDANCE_TOURISM", "Compañía de Turismo de Puerto Rico", "Ley 272-2003 — Registro de hosteleros (Art. 26, 13 L.P.R.A. § 2271q)", "https://tourism.pr.gov/", "Short-term lodging (stays of fewer than 90 days) registers with the Compañía de Turismo as an innkeeper (hostelero) and obtains an Innkeeper Identification Number; registration applies island-wide."),
  // REG-GUIDE-ROOMTAX-001 (2026-09-22 QA): S138 closed the §29.4
  // founder-settled chain question — innkeeper registration, Innkeeper ID
  // and the monthly room-tax return all fire — but the 7% room-tax rate
  // itself appeared nowhere in the graph's guidance. Verified 2026-09-22
  // on the PRTC's own page (tourism.pr.gov/room-tax/): "you must charge
  // your guests a room occupancy tax equal to 7% of the room's rate".
  roomTax: source("SRC_GUIDANCE_ROOM_TAX", "Compañía de Turismo de Puerto Rico", "Ley 272-2003, Art. 28(A)-(B) (13 L.P.R.A. § 2271s) — declaración del impuesto sobre el canon por ocupación de habitación; PRTC: 7% of the room rate", "https://tourism.pr.gov/room-tax/", "Article 28(A)-(B) governs the room-occupancy tax declaration: operators charge guests 7% of the room rate (PRTC) and file the monthly room-tax return with the Compañía de Turismo by the 10th of the following month."),
  // REG-GUIDE-OPPE-001 (2026-09-18 QA): the OPPE installer registration card
  // rendered the unvalidated-description placeholder on a live Toa Alta
  // solar-installer filing. The official Solicitud de Certificación form
  // (rev. Feb 2025) was verified on docs.pr.gov — the concept below is
  // grounded in that form and Ley 17-2019. No invented procedure.
  oppe: source("SRC_GUIDANCE_OPPE", "Programa de Política Pública Energética (PPPE), DDEC", "Ley 17-2019 (Política Pública Energética) — Certificación de Instalador de Sistemas Eléctricos Renovables", "https://docs.pr.gov/files/DDEC/PPPE/Solicitud%20de%20Certificaci%C3%B3n%20de%20Instalador%20de%20Sistemas%20El%C3%A9ctricos%20Renovables.pdf", "The PPPE certifies installers of renewable electric systems (photovoltaic or wind); new and renewal applications use the official Solicitud de Certificación (rev. Feb 2025), submitted by email to energia@ddec.pr.gov or in person."),
  // REG-GUIDE-FDA-001 (2026-09-21 QA): the FDA Food Facility Registration
  // card rendered the unvalidated-description placeholder on live Arecibo
  // brewery and Trujillo Alto roastery filings (S100/S102), with a confident
  // REQUIRED badge next to "A validated description of this document is
  // still pending." The concept below is grounded in FD&C Act §415
  // (21 U.S.C. §350d) and 21 CFR Part 1, Subpart H: domestic facilities —
  // including Puerto Rico — that manufacture/process/pack/hold food for US
  // consumption must register; biennial renewal Oct 1–Dec 31 of even years.
  fda: source("SRC_GUIDANCE_FDA", "U.S. Food and Drug Administration", "FD&C Act §415 (21 U.S.C. §350d); 21 CFR Part 1, Subpart H — Registration of Food Facilities", "https://www.fda.gov/food/online-registration-food-facilities", "Domestic facilities, including Puerto Rico, that manufacture, process, pack, or hold food for consumption in the United States must register with FDA; registrations renew biennially October 1–December 31 of even-numbered years."),
  // REG-GUIDE-WASTEWATER-001 (2026-09-21 QA): the Wastewater Discharge /
  // Sewer Pretreatment Authorization card rendered the unvalidated
  // placeholder on the same live beverage-manufacturing filings. Concept is
  // deliberately general — discharge/pretreatment authorization from AAA for
  // industrial wastewater to the public sewer, DRNA water-quality oversight —
  // with no invented thresholds, forms, or deadlines.
  wastewater: source("SRC_GUIDANCE_WASTEWATER", "Autoridad de Acueductos y Alcantarillados (AAA) / DRNA", "Puerto Rico industrial wastewater discharge — AAA sewer pretreatment authorization; DRNA water-quality oversight", "https://www.drna.pr.gov/", "Industrial wastewater discharged to AAA's public sewer system requires a discharge/pretreatment authorization from AAA; DRNA oversees water-quality protection island-wide."),
  // REG-GUIDE-STORMWATER-001 (2026-09-21 QA): the NPDES
  // Industrial-Stormwater card rendered the unvalidated placeholder on the
  // same live filings. Concept stays at the program level — NPDES coverage
  // or certified no-exposure exclusion via EPA/DRNA — no invented sector
  // codes or deadlines.
  stormwaterIndustrial: source("SRC_GUIDANCE_STORMWATER_INDUSTRIAL", "U.S. EPA / DRNA", "NPDES industrial stormwater — coverage or no-exposure certification", "https://www.epa.gov/npdes", "Industrial sites whose operations are exposed to stormwater need NPDES stormwater permit coverage or a certified no-exposure exclusion; in Puerto Rico this runs through the EPA/DRNA NPDES program."),
  // REG-GUIDE-AIR-001 (2026-09-21 QA): the Air Permit / Minor-Source
  // Determination card rendered the unvalidated placeholder on the same
  // live filings. Concept stays at the program level — DRNA administers
  // Puerto Rico's own air-emissions program (not federal EPA Title V) — no
  // invented emission thresholds.
  airPermit: source("SRC_GUIDANCE_AIR", "Departamento de Recursos Naturales y Ambientales (DRNA)", "Puerto Rico air quality program — air permit / minor-source determination", "https://www.drna.pr.gov/", "DRNA administers Puerto Rico's air-emissions program; manufacturing facilities with air emissions may need a DRNA air permit or a minor-source determination."),
  // REG-GUIDE-CHILDCARE-001 (2026-09-22 QA): the Childcare / Education
  // License card rendered the unvalidated-description placeholder on live
  // daycare filings. Concept grounded in Ley 173-2016 and the official
  // Departamento de la Familia licensing office (SULME): the office is the
  // office empowered by law to license and supervise childcare
  // establishments; it decides on a filed application within 90 days; the
  // license is issued for a specific site, is non-transferable, must be
  // displayed publicly, and lasts no more than two years.
  childcareLicensing: source("SRC_GUIDANCE_CHILDCARE_LICENSING", "Departamento de la Familia — Oficina de Licenciamiento (SULME)", "Ley 173-2016, Ley para el Licenciamiento de Establecimientos de Cuidado, Desarrollo y Aprendizaje de los Niños y Niñas — childcare establishments are licensed and supervised by the Departamento de la Familia", "https://childcare.familia.pr.gov/proveedores/licenciamientos.html", "The Oficina de Licenciamiento is the office empowered by law to license and supervise public and private childcare establishments in Puerto Rico; it decides on a complete license application within 90 days, and the license is issued for the specific site and entity, is non-transferable, must be displayed publicly, and lasts no more than two years."),
  // REG-GUIDE-HOA-001 (2026-09-22 QA): the Condo / HOA Short-Term Rental
  // Authorization card rendered the unvalidated-description placeholder on a
  // live Guaynabo STR filing (S138). Concept grounded in the rule's own
  // cited authority, Ley 129-2020 (Ley de Condominios), Art. 40
  // (31 L.P.R.A § 1922l) — verified in the OGP Biblioteca Virtual text
  // (rev. 10 Aug 2026): STRs of condo units cannot be prohibited unless the
  // escritura matriz or the reglamento contains an express prohibition or a
  // minimum lease term; the reglamento may regulate how STRs are conducted,
  // including a minimum number of nights and a special monthly fee (capped
  // at the maintenance fee). The copy stays conditional on what the
  // documents actually contain — never a claim of a universal HOA permit.
  hoaCondo: source("SRC_GUIDANCE_HOA_CONDO", "Oficina de Gerencia y Presupuesto — Biblioteca Virtual (Ley 129-2020)", "Ley 129-2020 (Ley de Condominios), Art. 40 (31 L.P.R.A § 1922l) — short-term rentals of condo units cannot be prohibited unless the escritura matriz or reglamento contains an express prohibition or a minimum lease term", "https://bvirtualogp.pr.gov/ogp/Bvirtual/leyesreferencia/PDF/129-2020.pdf", "Article 40 provides that short-term rentals of apartments under the horizontal-property regime cannot be prohibited unless the master deed or regulations contain an express prohibition or a minimum lease term; the regulations may govern how STRs are conducted, including a minimum number of nights and a special monthly fee not greater than the maintenance fee."),
  // REG-GUIDE-ENTERTAINMENT-001 (2026-09-22 QA): the Entertainment Permit
  // card rendered the unvalidated-description placeholder on a live Dorado
  // no-food-bar filing (S139). The rule (RULE_0032) cites the municipal
  // entertainment ordinances + Ley 161-2009 Art. 8.4A; both were verified
  // verbatim in the OGP Biblioteca Virtual today. lastVerified is set
  // explicitly: the shared source() helper stamps 2026-09-03, which would
  // be dishonest here.
  entertainment161: {
    id: "SRC_GUIDANCE_ENTERTAINMENT_PERMIT",
    agency: "Oficina de Gerencia y Presupuesto — Biblioteca Virtual (Ley 161-2009)",
    citation: "Ley 161-2009, Art. 8.4A (23 L.P.R.A § 9018c-1) — el Permiso Único para edificaciones o negocios no residenciales, nuevos o existentes, incluye las licencias y autorizaciones aplicables, consolidadas en una sola solicitud",
    url: "https://bvirtualogp.pr.gov/ogp/BVirtual/LeyesOrganicas/pdf/161-2009.pdf",
    lastVerified: "2026-09-22",
    sourceVersion: "public-guidance-2026-09-22",
    supports: "Art. 8.4A verified verbatim: el Permiso Único para edificaciones o negocios no residenciales, nuevos o existentes, incluirá cualquier tipo de permiso, endoso, certificado, licencia, inspección, consulta o certificación que se requiera para su operación — las licencias y autorizaciones aplicables al negocio se consolidan en una sola solicitud.",
  },
  entertainmentPromoterLaw: {
    id: "SRC_GUIDANCE_PROMOTER_LAW",
    agency: "Departamento de Hacienda — Biblioteca Virtual (Ley 182-1996)",
    citation: "Ley 182-1996 (Ley del Promotor de Espectáculos Públicos) — los promotores de espectáculos públicos se registran y obtienen licencia en el Departamento de Hacienda",
    url: "https://bvirtualogp.pr.gov/ogp/Bvirtual/LeyesOrganicas/pdf/182-1996.pdf",
    lastVerified: "2026-09-22",
    sourceVersion: "public-guidance-2026-09-22",
    supports: "Ley 182-1996 creates a Hacienda registration and license for promoters of public shows (promotores de espectáculos públicos) — a person or entity that organizes and sells public shows. It is distinct from a venue's municipal authorization to host its own in-house entertainment.",
  },
};

// REG-KB-GAPS-001 (2026-10-04): primary sources for the KB-gap concepts.
const gapSource = (id: string, agency: string, citation: string, url: string, supports: string): GuidanceSource => ({ id, agency, citation, url, supports, lastVerified: "2026-10-04", sourceVersion: "public-guidance-2026-10-04" });
const KB_GAP_SOURCES = {
  icp: gapSource("SRC_GUIDANCE_ICP_LEY374", "Instituto de Cultura Puertorriqueña", "Ley Núm. 374 de 14 de mayo de 1949, Art. 1 (23 L.P.R.A. § 161)", "https://bvirtualogp.pr.gov/ogp/Bvirtual/leyesreferencia/PDF/Turismo/374-1949/374-1949.pdf", "In a historic zone, OGPe and the autonomous municipalities with delegated permit levels must obtain the ICP's written recommendation before authorizing any construction or use permit."),
  rcHistoric: gapSource("SRC_GUIDANCE_RC2023_HISTORIC", "OGPe / Junta de Planificación", "Reglamento Conjunto 2023, Regla 10.2.11 (Secs. 10.2.11.2 y 10.2.11.5)", "https://docs.pr.gov/files/DDEC/OGPe/Reglamentos/RC-2023-E.pdf", "The Joint Regulation applies ICP review to National Register buildings, JP-registered historic sites and zones, and founding-center plazas, and lists the ICP recommendations (construction, use, demolition, signs, awnings, paint, alcohol sales)."),
  section106: gapSource("SRC_GUIDANCE_NHPA_106", "Advisory Council on Historic Preservation / State Historic Preservation Office", "National Historic Preservation Act § 106 (54 U.S.C. § 306108); 36 C.F.R. Part 800", "https://www.ecfr.gov/current/title-36/chapter-VIII/part-800", "Federal agencies must take into account the effects of their funded, permitted or licensed undertakings on historic properties and consult the State Historic Preservation Officer."),
  reg13Floodway: gapSource("SRC_GUIDANCE_REG13_FLOODWAY", "Junta de Planificación / DRNA", "Reglamento de Planificación Núm. 13 (Octava Revisión, 2021), Sec. 6.01", "https://portaldeinundacion.jp.pr.gov/uploads/Documentos/Reglamento-Num-13-Octava-Revision-Vigencia-9-Enero-2021-1.pdf", "Encroachments in the regulatory floodway are prohibited unless an alternatives analysis and a hydrologic-hydraulic study evaluated by DRNA demonstrate no rise in the base flood level."),
  nfipFloodway: gapSource("SRC_GUIDANCE_44CFR60_3", "FEMA", "44 C.F.R. § 60.3(d)(3)", "https://www.ecfr.gov/current/title-44/chapter-I/subchapter-B/part-60/subpart-A/section-60.3", "Communities must prohibit encroachments in the regulatory floodway unless a certified hydrologic and hydraulic analysis shows no increase in flood levels during the base flood."),
  prControlled: gapSource("SRC_GUIDANCE_PR_CONTROLLED", "Departamento de Salud", "Ley Núm. 4 de 23 de junio de 1971, Arts. 302–304; Formulario DS-DI-016", "https://www.salud.pr.gov/CMS/DOWNLOAD/2563", "Every person who manufactures, distributes or dispenses controlled substances in Puerto Rico must obtain a registration from the Secretario de Salud, issued on the Departamento de Salud's application form."),
  dea: gapSource("SRC_GUIDANCE_DEA_1301", "U.S. Drug Enforcement Administration", "21 U.S.C. § 822; 21 C.F.R. §§ 1301.11, 1301.13", "https://www.ecfr.gov/current/title-21/chapter-II/part-1301", "Every person who dispenses controlled substances must obtain a DEA registration for each principal place of business; pharmacies apply on DEA Form 224."),
  cannabis: gapSource("SRC_GUIDANCE_LEY42_2017", "Junta Reglamentadora del Cannabis Medicinal", "Ley Núm. 42-2017, Arts. 2, 4 y 10", "https://bvirtualogp.pr.gov/ogp/Bvirtual/leyesreferencia/PDF/Sustancias/42-2017.pdf", "The Junta Reglamentadora del Cannabis Medicinal licenses medical cannabis establishments, including dispensaries; only licensed establishments may dispense medical cannabis, and dispensary entry is limited to patients and adults 21 or older."),
  ley89: gapSource("SRC_GUIDANCE_LEY89_2000", "OGPe / Junta de Planificación", "Ley Núm. 89 de 6 de junio de 2000, Arts. 5, 7 y 8", "https://bvirtualogp.pr.gov/ogp/Bvirtual/leyesreferencia/PDF/Telecomunicaciones/89-2000.pdf", "New telecommunications towers must meet statutory setbacks, include a sworn co-location statement, and give written notice to neighbors within 100 meters as part of their permit."),
  faa77: gapSource("SRC_GUIDANCE_14CFR77_9", "Federal Aviation Administration", "14 C.F.R. § 77.9", "https://www.ecfr.gov/current/title-14/chapter-I/subchapter-E/part-77", "Notice to the FAA is required for construction more than 200 feet above ground level and for structures near airports that exceed the notice slopes."),
  fcc17: gapSource("SRC_GUIDANCE_47CFR17_4", "Federal Communications Commission", "47 C.F.R. § 17.4", "https://www.ecfr.gov/current/title-47/chapter-I/subchapter-A/part-17", "The owner of an antenna structure that requires FAA notice must register it with the FCC and display the registration number."),
  netRegistry: gapSource("SRC_GUIDANCE_NET_TOWERS", "Negociado de Telecomunicaciones de Puerto Rico", "Registro de torres de telecomunicaciones", "https://wifi.jrtpr.pr.gov/towersapp/torres.aspx", "The Negociado de Telecomunicaciones publishes and maintains a registry of telecommunications towers in Puerto Rico."),
  ley430: gapSource("SRC_GUIDANCE_LEY430_2000", "DRNA", "Ley Núm. 430-2000 (Ley de Navegación y Seguridad Acuática), Art. 9", "https://bvirtualogp.pr.gov/ogp/Bvirtual/leyesreferencia/PDF/2/0430-2000.pdf", "Motorized vessels and jet skis used in Puerto Rico waters must be registered with the DRNA, and owners of rental vessels must meet the statute's rental duties."),
  cp10: gapSource("SRC_GUIDANCE_DRNA_CP10", "DRNA", "Formulario CP-10 — Solicitud de Licencia para Dueños de Bote de Alquiler", "https://www.drna.pr.gov/documentos/formularios/cp-10-solicitud-de-licencia-para-duenos-de-bote-de-alquiler/", "The DRNA licenses owners of rental boats through its official CP-10 application."),
  reg4860: gapSource("SRC_GUIDANCE_DRNA_REG4860", "DRNA", "Reglamento Núm. 4860, Arts. 4.1–4.3", "https://www.drna.pr.gov/wp-content/uploads/2015/10/REGLAMENTO-4860-Version-Completa-y-enmiendas-Agosto-2015.pdf", "Uses, works and activities in the maritime-terrestrial zone, territorial waters and submerged lands require a DRNA concession or authorization."),
  usace: gapSource("SRC_GUIDANCE_33CFR322", "U.S. Army Corps of Engineers", "33 U.S.C. § 403; 33 C.F.R. Part 322", "https://www.ecfr.gov/current/title-33/chapter-II/part-322", "Structures or work in or affecting navigable waters of the United States, including docks and piers, require a Department of the Army permit under Section 10."),
  recycling: gapSource("SRC_GUIDANCE_DRNA_RECYCLING", "DRNA", "Reglamento para la Reducción, Reutilización y el Reciclaje de los Desperdicios Sólidos, Cap. VIII, Reglas 2 y 4; Ley Núm. 70-1992", "https://www.drna.pr.gov/wp-content/uploads/2019/09/ReglamentoReciclaje.pdf", "No recycling facility may operate without the agency's endorsement; the endorsement is valid for two years."),
  neshap6h: gapSource("SRC_GUIDANCE_40CFR63_6H", "U.S. Environmental Protection Agency", "40 C.F.R. Part 63, Subpart HHHHHH", "https://www.ecfr.gov/current/title-40/chapter-I/subchapter-C/part-63/subpart-HHHHHH", "Area-source shops that spray-apply coatings to motor vehicles must use filtered spray booths and high-efficiency spray guns, train painters, and submit an initial notification."),
};

const employee = condition("Q_EMPLOYEES_HIRED", "Hiring employees", "Contratación de empleados", true);
const municipality = condition("municipality", "Municipality", "Municipio");
const business = condition("businessType", "Commercial activity", "Actividad comercial");
const SUBJECTS: Record<string, { en: string[]; es: string[] }> = {
  DOC_ALCOHOL_LICENSE: { en: ["alcohol"], es: ["alcohol", "alcohólic"] },
  DOC_TOBACCO_RETAIL_LICENSE: { en: ["tobacco", "cigarette"], es: ["tabaco", "cigarrillos"] },
  DOC_TOBACCO_SALES_PROJECTION: { en: ["tobacco", "projection"], es: ["tabaco", "proyección"] },
  // §29.2: alcohol-license prerequisites — children of the alcohol license.
  DOC_ASUME_CLEARANCE: { en: ["asume", "child support clearance"], es: ["asume", "sustento de menores"] },
  DOC_CRIM_CLEARANCE: { en: ["crim", "property debt clearance"], es: ["crim", "deuda contributiva"] },
  DOC_BACKGROUND_CHECK: { en: ["criminal record", "antecedentes penales"], es: ["antecedentes penales", "certificado de antecedentes"] },
  // REG-GUIDE-CHILDCARE-001 (2026-09-22 QA): the childcare-license card
  // rendered the unvalidated-description placeholder on live daycare
  // filings. Subject terms for the validated concept (Ley 173-2016).
  DOC_CHILDCARE_LICENSE: { en: ["childcare", "license", "daycare"], es: ["cuido", "licencia de cuido", "niños"] },
  // REG-GUIDE-HOA-001 (2026-09-22 QA): subject terms for the validated
  // condo/HOA STR authorization concept (Ley 129-2020).
  DOC_HOA_AUTHORIZATION: { en: ["hoa", "condo", "condominio", "short-term rental authorization"], es: ["hoa", "condominio", "autorización de alquiler", "corto plazo"] },
  // REG-GUIDE-ENTERTAINMENT-001 (2026-09-22 QA): subject terms for the
  // validated entertainment-permit concept (Ley 161-2009 Art. 8.4A; Ley
  // 182-1996 promoter disambiguation).
  DOC_ENTERTAINMENT_PERMIT: { en: ["entertainment", "live music", "trio", "dj", "variety show", "espectáculo", "municipal entertainment permit"], es: ["entretenimiento", "música en vivo", "trío", "dj", "variedades", "permiso de entretenimiento", "ordenanza municipal"] },
  DOC_EIN: { en: ["ein", "federal tax identifier"], es: ["ein", "identificador contributivo"] },
  DOC_SAM_REGISTRATION: { en: ["sam.gov", "federal registration", "federal contractor"], es: ["sam.gov", "registro federal", "contratista federal"] },
  DOC_CONTRACTOR_LICENSE: { en: ["DACO", "contractor registry", "urbanizador", "constructor"], es: ["DACO", "registro de contratistas", "urbanizador", "constructor"] },
  // REG-DEALER-DACO-001 (2026-09-25 QA): subject terms for the DACO
  // dealer-license concept (daco.pr.gov/consumidores — Registro Único de
  // Dealers; dealers must hold a DACO license to operate).
  DOC_DACO_DEALER_LICENSE: { en: ["DACO", "dealer license", "car dealer", "dealership", "concesionario"], es: ["DACO", "licencia de dealer", "dealer", "concesionario", "vehículos de motor"] },
  // REG-FOREIGN-AUTH-001 (2026-09-27 QA): subject terms for the foreign-
  // corporation authorization concept (Ley 164-2009 Art. 13.01; CORPREG03).
  DOC_FOREIGN_CORPORATION_AUTHORIZATION: { en: ["foreign corporation", "certificate of authorization", "authorization to do business", "CORPREG03"], es: ["corporación extranjera", "certificado de autorización", "hacer negocios en puerto rico", "CORPREG03"] },
  DOC_MERCHANT_REGISTRATION: { en: ["merchant", "suri", "ivu"], es: ["comerciante", "suri", "ivu"] },
  DOC_PERMISO_UNICO: { en: ["permit"], es: ["permiso", "solicitud en sbp"] },
  DOC_PATENTE_MUNICIPAL: { en: ["patent", "municipal tax"], es: ["patente", "contributivo municipal"] },
  DOC_LEASE_AGREEMENT: { en: ["lease", "landlord"], es: ["contrato", "arrendador"] },
  DOC_ARTICLES_ORGANIZATION: { en: ["llc", "limited liability company", "organization"], es: ["llc", "compañía de responsabilidad limitada", "organización"] },
  // REG-GUIDE-FORMATION-001 (2026-09-17 QA): validated subject terms for the
  // formation-certificate cards that were rendering placeholder copy.
  DOC_CERT_INCORPORATION: { en: ["incorporation", "certificate of incorporation", "corporation"], es: ["incorporación", "certificado de incorporación", "corporación"] },
  DOC_CERT_ORGANIZATION: { en: ["organization", "llc", "certificate of organization"], es: ["organización", "llc", "certificado de organización"] },
  DOC_HACIENDA_EMPLOYER_WITHHOLDING: { en: ["withholding", "suri", "employer withholding"], es: ["retención", "suri", "agente retenedor"] },
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
  // REG-GUIDE-FDA-001 / REG-GUIDE-WASTEWATER-001 / REG-GUIDE-STORMWATER-001 /
  // REG-GUIDE-AIR-001 (2026-09-21 QA): validated subject terms for the FDA
  // registration and the three environmental cards that were rendering
  // placeholder copy on live beverage-manufacturing filings.
  DOC_FDA_FOOD_FACILITY_REGISTRATION: { en: ["fda", "food facility", "federal registration"], es: ["fda", "instalación alimentaria", "registro federal"] },
  DOC_WASTEWATER_DISCHARGE_AUTHORIZATION: { en: ["wastewater", "sewer", "pretreatment", "discharge"], es: ["aguas residuales", "alcantarillado", "pretratamiento", "descarga"] },
  DOC_NPDES_INDUSTRIAL_STORMWATER: { en: ["stormwater", "npdes", "no-exposure"], es: ["aguas pluviales", "npdes", "no exposición"] },
  DOC_AIR_PERMIT: { en: ["air permit", "emissions", "minor-source"], es: ["permiso de aire", "emisiones", "fuente menor"] },
  // REG-KB-GAPS-001 (2026-10-04): subject terms for the KB-gap concepts.
  DOC_ICP_HISTORIC_RECOMMENDATION: { en: ["ICP", "historic"], es: ["ICP", "históric"] },
  DOC_SHPO_SECTION106_REVIEW: { en: ["Section 106", "historic preservation"], es: ["Sección 106", "conservación histórica"] },
  DOC_FLOODWAY_NO_RISE_CERTIFICATION: { en: ["floodway", "no-rise"], es: ["cauce mayor", "sin aumento"] },
  DOC_PR_CONTROLLED_SUBSTANCES_REGISTRATION: { en: ["controlled substances", "controlled-substances"], es: ["sustancias controladas"] },
  DOC_DEA_REGISTRATION: { en: ["DEA"], es: ["DEA"] },
  DOC_CANNABIS_DISPENSARY_LICENSE: { en: ["cannabis"], es: ["cannabis"] },
  DOC_TELECOM_TOWER_SITING: { en: ["tower"], es: ["torre"] },
  DOC_FAA_7460_NOTICE: { en: ["FAA"], es: ["FAA"] },
  DOC_FCC_ASR: { en: ["FCC", "antenna structure"], es: ["FCC", "estructura de antena"] },
  DOC_NET_TOWER_REGISTRY: { en: ["tower registry", "Negociado de Telecomunicaciones"], es: ["registro de torres", "Negociado de Telecomunicaciones"] },
  DOC_DRNA_VESSEL_REGISTRATION: { en: ["vessel", "watercraft"], es: ["embarcaci", "inscripción"] },
  DOC_DRNA_BOAT_RENTAL_LICENSE: { en: ["rental"], es: ["alquiler"] },
  DOC_DRNA_MARITIME_CONCESSION: { en: ["maritime-terrestrial", "submerged lands"], es: ["marítimo-terrestre", "terrenos sumergidos"] },
  DOC_USACE_SECTION10: { en: ["Corps", "Section 10"], es: ["Cuerpo de Ingenieros", "Sección 10"] },
  DOC_DRNA_RECYCLING_FACILITY_ENDORSEMENT: { en: ["recycling"], es: ["reciclaje"] },
  DOC_EPA_AUTOBODY_NESHAP_NOTICE: { en: ["spray", "coating"], es: ["pintura", "recubrimiento"] },
  // REG-GUIDE-SIGN-001 / REG-GUIDE-ANNUAL-001 (2026-09-20 QA): validated
  // subject terms for the sign/rótulo and annual-report cards that were
  // rendering placeholder copy on live filings.
  DOC_SIGN_PERMIT: { en: ["sign", "rótulo", "signage"], es: ["rótulo", "letrero", "rotulación"] },
  DOC_ANNUAL_REPORT: { en: ["annual report", "annual fee"], es: ["informe anual", "anualidad"] },
  DOC_VEHICLE_REGISTRATION: { en: ["vehicle registration", "dtop", "marbete"], es: ["registro de vehículos", "vehículo comercial", "dtop", "marbete"] },
  DOC_TRANSPORT_PERMIT: { en: ["transport", "ntsp", "franchise", "porteador"], es: ["transporte", "ntsp", "franquicia", "porteador", "acarreo"] },
  // REG-GUIDE-AMBULANT-001 (2026-10-06 QA, live S454): validated subject
  // terms for the Municipal Ambulant-Business License card that rendered
  // the unvalidated-description placeholder on a live Toa Baja food-truck
  // filing while citing a genuine statute (Ley 81-1991, Art. 20.003).
  DOC_AMBULANT_BUSINESS_LICENSE: { en: ["ambulant business", "mobile business", "food truck license"], es: ["negocio ambulante", "licencia de negocio ambulante", "vendedor ambulante"] },
  // REG-GUIDE-USEDOIL-001 (2026-10-06 QA, live S467): validated subject terms
  // for the DRNA used-oil generator ID and EPA/DRNA hazardous-waste generator
  // ID cards that rendered the unvalidated-description placeholder on a live
  // Toa Baja auto-repair filing (Ley 172-1996; RCRA 40 CFR 262 / Ley 70-1992).
  DOC_USED_OIL_GENERATOR_ID: { en: ["used oil", "oil generator", "aceite usado"], es: ["aceite usado", "generador de aceite", "drna"] },
  DOC_EPA_HAZARDOUS_WASTE_ID: { en: ["hazardous waste", "hazardous waste generator", "rcra"], es: ["desperdicios peligrosos", "generador de desperdicios", "rcra"] },
  DOC_AGRICULTURE_REGISTRATION: { en: ["bona fide", "farmer", "agriculture"], es: ["bona fide", "agricultor", "agricultura", "finca"] },
  // REG-GUIDE-TOURISM-001 (2026-09-18 QA): validated subject terms for the
  // PRTC innkeeper registration and room-tax return cards that were
  // rendering placeholder copy.
  DOC_TOURISM_REGISTRATION: { en: ["innkeeper", "tourism", "lodging", "hostelero"], es: ["hostelero", "turismo", "hospedería", "alojamiento"] },
  DOC_ROOM_TAX_RETURN: { en: ["room tax", "room-occupancy", "monthly return"], es: ["impuesto de habitación", "declaración mensual", "canon por ocupación"] },
  // REG-GUIDE-OUTDOOR-001 (2026-09-20 QA): the Outdoor Seating Authorization
  // card rendered the unvalidated-description placeholder on a live Mayagüez
  // café filing. Subject terms for the validated concept.
  DOC_OUTDOOR_SEATING_AUTH: { en: ["outdoor seating", "sidewalk", "public space"], es: ["mesas en la acera", "acera", "espacio público", "café al aire libre"] },
  // REG-GUIDE-TAX-COMPLIANCE-001 (2026-09-21 QA): the Hacienda Tax Filing &
  // Debt Compliance card rendered the unvalidated-description placeholder on
  // live Carolina and Ponce alcohol-chain filings. Subject terms for the
  // validated concept.
  DOC_HACIENDA_TAX_COMPLIANCE: { en: ["tax filing", "debt compliance", "Hacienda"], es: ["radicación de planillas", "cumplimiento contributivo", "deudas contributivas"] },
  // REG-GUIDE-ALCOHOL-SALES-001 (2026-09-21 QA): the Alcohol Sales Projection
  // card rendered the unvalidated-description placeholder on live
  // alcohol-chain filings. Subject terms for the validated concept.
  DOC_ALCOHOL_SALES_PROJECTION: { en: ["sales projection", "projected sales", "alcohol sales"], es: ["proyección de ventas", "ventas de alcohol", "volumen"] },
};
function concept(requirementId: string, conditions: GuidanceCondition[][], sources: GuidanceSource[], content: [LocalizedText, LocalizedText, LocalizedText, LocalizedText], dependencies: string[] = [], conditionalDependencies?: GuidanceConcept["conditionalDependencies"], branchContext?: GuidanceConcept["branchContext"]): GuidanceConcept {
  return { requirementId, version: "2026-09-03.1", validationStatus: "validated", subjectTerms: SUBJECTS[requirementId], conditions, sources, regulatoryReason: content[0], purpose: content[1], nextAction: content[2], consequenceOrNextStep: content[3], dependencies,
    ...(conditionalDependencies ? { conditionalDependencies } : {}),
    ...(branchContext ? { branchContext } : {}),
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
  // REG-TOBACCO-RETAIL-001 (2026-09-28 QA): Puerto Rico licenses retail
  // cigarette and tobacco dealers (Licencia de Detallista de Cigarrillos)
  // under Sec. 3050.01 of the Código de Rentas Internas de 2011 (verified
  // 2026-09-28 on Hacienda's official internal-revenue license-requirements
  // page). Tobacco sales need their own Hacienda license — separate from the
  // alcohol dealer license (§29.2-class isolation).
  DOC_TOBACCO_RETAIL_LICENSE: concept("DOC_TOBACCO_RETAIL_LICENSE", [[condition("Q_TOBACCO_SOLD", "Tobacco sales: Yes", "Venta de productos de tabaco: Sí", true)]], [PR_GUIDANCE_SOURCES.tobaccoReqs], [
    text("Selling cigarettes, cigars and other tobacco products at retail is separately licensed. Ordinary business registration does not itself authorize tobacco sales.", "La venta al detal de cigarrillos, cigarros y otros productos de tabaco requiere una licencia específica. El registro del negocio por sí solo no autoriza esas ventas."),
    text("The Hacienda license authorizes the retail tobacco sales specified in it — cigarettes, cigars, tobacco products and related devices covered by the dealer's filing.", "La licencia de Hacienda autoriza las ventas de tabaco al detal que especifica — cigarrillos, cigarros, productos de tabaco y artículos relacionados cubiertos por la solicitud del traficante."),
    text("Confirm the sales category, complete the cigarette-dealer license application (Modelo SC 2309), and supply the supporting evidence requested — including the ASUME and CRIM certifications, the criminal-record certificate, and the sales projection.", "Confirma la categoría de venta, completa la solicitud de licencia de detallista de cigarrillos (Modelo SC 2309) y aporta la evidencia de respaldo correspondiente — incluyendo las certificaciones de ASUME y CRIM, el certificado de antecedentes penales y la proyección de ventas."),
    text("Issuance authorizes only the tobacco sales covered by that license, subject to its conditions; a prepared application is not authorization.", "La expedición autoriza solo las ventas de tabaco cubiertas por la licencia y sus condiciones; una solicitud preparada no es una autorización."),
  ]),
  // §29.2 (founder judgment 2026-09-16): ASUME, CRIM and the criminal-record
  // certificate are prerequisites of the retail alcohol beverage license —
  // never generic restaurant requirements. Modeled as children of
  // DOC_ALCOHOL_LICENSE via dependencies.
  // REG-TOBACCO-RETAIL-001 (2026-09-28 QA): the ASUME clearance is also a
  // prerequisite of the retail cigarette dealer license (RULE_0702), not
  // only of the alcohol license. Following the REG-GUIDE-BACKGROUND-001/002
  // pattern: shared body copy stays context-free; the requiring basis lives
  // in branchContext per matched branch; dependencies are conditional.
  // The alcohol branch is unchanged.
  DOC_ASUME_CLEARANCE: concept("DOC_ASUME_CLEARANCE", [
    [condition("Q_ALCOHOL_SOLD", "Alcohol sales: Yes", "Venta de alcohol: Sí", true)],
    [condition("Q_TOBACCO_SOLD", "Tobacco sales: Yes", "Venta de productos de tabaco: Sí", true)],
  ], [PR_GUIDANCE_SOURCES.alcoholReqs, PR_GUIDANCE_SOURCES.tobaccoReqs], [
    text("Hacienda requires the ASUME child-support clearance as a prerequisite for its internal-revenue dealer licenses (licencias de rentas internas) — it proves the applicant owes no child-support debt to ASUME.", "Hacienda exige la certificación de ASUME como prerrequisito de sus licencias de traficante de rentas internas — acredita que el solicitante no tiene deuda de sustento de menores con ASUME."),
    text("The ASUME clearance certifies child-support compliance; without it Hacienda will not issue the dealer license that requires it.", "La certificación de ASUME acredita el cumplimiento con el sustento de menores; sin ella Hacienda no expide la licencia de traficante que la exige."),
    text("Request the ASUME certification through ASUME/Familia offices and file it with the license application in SURI.", "Solicita la certificación de ASUME en las oficinas de ASUME/Familia y radícala junto a la solicitud de licencia en SURI."),
    text("Once Hacienda accepts the ASUME clearance, the license file moves forward; an expired or missing clearance stalls issuance.", "Una vez Hacienda acepta la certificación de ASUME, el expediente de la licencia avanza; una certificación vencida o ausente detiene la expedición."),
  ], [], [
    { factKey: "Q_ALCOHOL_SOLD", factValue: true, documentId: "DOC_ALCOHOL_LICENSE" },
    { factKey: "Q_TOBACCO_SOLD", factValue: true, documentId: "DOC_TOBACCO_RETAIL_LICENSE" },
  ], [
    text("Hacienda requires the ASUME child-support clearance inside the retail alcohol beverage license file.", "Hacienda exige la certificación de ASUME dentro del expediente de la licencia de bebidas alcohólicas al detal."),
    text("Hacienda requires the ASUME child-support clearance inside the retail cigarette dealer license file.", "Hacienda exige la certificación de ASUME dentro del expediente de la licencia de detallista de cigarrillos."),
  ]),
  // REG-TOBACCO-RETAIL-001 (2026-09-28 QA): the CRIM clearance is also a
  // prerequisite of the retail cigarette dealer license (RULE_0703). Same
  // BACKGROUND-pattern restructure as ASUME above; the alcohol branch is
  // unchanged.
  DOC_CRIM_CLEARANCE: concept("DOC_CRIM_CLEARANCE", [
    [condition("Q_ALCOHOL_SOLD", "Alcohol sales: Yes", "Venta de alcohol: Sí", true)],
    [condition("Q_TOBACCO_SOLD", "Tobacco sales: Yes", "Venta de productos de tabaco: Sí", true)],
  ], [PR_GUIDANCE_SOURCES.alcoholReqs, PR_GUIDANCE_SOURCES.tobaccoReqs], [
    text("Hacienda requires the CRIM property debt clearance as a prerequisite for its internal-revenue dealer licenses (licencias de rentas internas) — it certifies the applicant has no outstanding movable-property tax debt with CRIM.", "Hacienda exige la certificación de deuda del CRIM como prerrequisito de sus licencias de traficante de rentas internas — certifica que el solicitante no tiene deuda contributiva sobre propiedad mueble con el CRIM."),
    text("The CRIM clearance proves municipal property-tax compliance; Hacienda treats it as a gate for the dealer license that requires it.", "La certificación del CRIM prueba el cumplimiento contributivo municipal; Hacienda la trata como un filtro para la licencia de traficante que la exige."),
    text("Obtain the negative debt certification through the CRIM360 portal and attach it to the license application.", "Obtén la certificación negativa de deuda en el portal CRIM360 y anéxala a la solicitud de licencia."),
    text("A clean CRIM clearance lets the license application proceed; unresolved CRIM debt blocks the license until paid.", "Una certificación del CRIM limpia deja avanzar la solicitud de licencia; una deuda contributiva sin resolver bloquea la licencia hasta saldarla."),
  ], [], [
    { factKey: "Q_ALCOHOL_SOLD", factValue: true, documentId: "DOC_ALCOHOL_LICENSE" },
    { factKey: "Q_TOBACCO_SOLD", factValue: true, documentId: "DOC_TOBACCO_RETAIL_LICENSE" },
  ], [
    text("Hacienda requires the CRIM property debt clearance inside the retail alcohol beverage license file.", "Hacienda exige la certificación de deuda del CRIM dentro del expediente de la licencia de bebidas alcohólicas al detal."),
    text("Hacienda requires the CRIM property debt clearance inside the retail cigarette dealer license file.", "Hacienda exige la certificación de deuda del CRIM dentro del expediente de la licencia de detallista de cigarrillos."),
  ]),
  // §29.2 (founder judgment 2026-09-16): ASUME, CRIM and the criminal-record
  // certificate are prerequisites of the retail alcohol beverage license —
  // never generic restaurant requirements. They are modeled as children of
  // DOC_ALCOHOL_LICENSE via conditional dependencies (REG-GUIDE-BACKGROUND-001).
  //
  // REG-GUIDE-BACKGROUND-001 (2026-09-22 QA): the same certificate is also
  // the staffing background check for childcare/education businesses and
  // security contractors. The concept copy is therefore written about the
  // certificate itself (not only the alcohol file), and the conditions gain
  // a branch per requiring context so the card's trigger label names the
  // real basis. The alcohol branch is unchanged.
  // REG-GUIDE-BACKGROUND-002 (2026-09-22 QA, live S125): the shared body
  // copy stays context-free; the requiring basis lives in branchContext so
  // each matched branch renders only its own basis. A daycare card never
  // mentions the alcohol file; an alcohol filing still sees the Hacienda
  // basis (§29.2).
  DOC_BACKGROUND_CHECK: concept("DOC_BACKGROUND_CHECK", [
    [condition("Q_ALCOHOL_SOLD", "Alcohol sales: Yes", "Venta de alcohol: Sí", true)],
    [condition("Q_ALCOHOL_SERVED", "Alcohol service: Yes", "Servicio de alcohol: Sí", true)],
    [condition("Q_ALCOHOL_MANUFACTURED", "Alcohol manufacturing: Yes", "Manufactura de alcohol: Sí", true)],
    [condition("Q_TOBACCO_SOLD", "Tobacco sales: Yes", "Venta de productos de tabaco: Sí", true)],
    [condition("Q_CHILDREN_PRESENT", "Children present at the business: Yes", "Niños presentes en el negocio: Sí", true)],
    ...["BT_DAYCARE", "BT_TUTORING_CENTER", "BT_PRIVATE_SCHOOL", "BT_VOCATIONAL_SCHOOL", "BT_TRAINING_COMPANY", "BT_AFTER_SCHOOL_PROGRAM"].map(bt => [condition("businessType", "Childcare/education staffing", "Personal de cuido/educación", bt)]),
    [condition("businessType", "Security staff", "Personal de seguridad", "BT_SECURITY_CONTRACTOR")],
  ], [PR_GUIDANCE_SOURCES.alcoholReqs, PR_GUIDANCE_SOURCES.tobaccoReqs, PR_GUIDANCE_SOURCES.antecedentes], [
    text("The criminal-record certificate (Certificado de Antecedentes Penales) documents a person's criminal history as recorded by the Policía de Puerto Rico, which issues it under Ley 254-1974. Every licensing process that asks for criminal-record documentation accepts this certificate as the proof.", "El certificado de antecedentes penales documenta el historial delictivo de una persona según lo registra la Policía de Puerto Rico, que lo expide bajo la Ley 254-1974. Todo proceso de licenciamiento que pida documentación de antecedentes penales acepta este certificado como prueba."),
    text("The certificate proves the applicant or staff member has no disqualifying criminal record for the filing that requires it. The Policía issues it free through the official pr.gov portal, and every licensing process that asks for criminal-record documentation accepts it.", "El certificado prueba que el solicitante o empleado no tiene un récord criminal que lo descalifique para la solicitud que lo exige. La Policía lo expide gratis en el portal oficial de pr.gov, y todo proceso de licenciamiento que pida documentación de antecedentes penales lo acepta."),
    text("Request a Certificado de Antecedentes Penales for each person who must be cleared — through the official pr.gov portal (free, online) — and file each certificate with the application that requires it.", "Solicita un certificado de antecedentes penales para cada persona que haya que depurar — en el portal oficial de pr.gov (gratis, en línea) — y radica cada certificado con la solicitud que lo exige."),
    text("Without a criminal record certificate on file, the requiring application cannot move forward. Keep certificates current wherever renewals ask for fresh criminal-record checks.", "Sin el certificado de antecedentes penales en el expediente, la solicitud que lo exige no puede avanzar. Mantén los certificados vigentes donde las renovaciones pidan verificaciones de antecedentes nuevas."),
  ], [], [
    // REG-GUIDE-BACKGROUND-001 (2026-09-22 QA): the certificate is a child
    // of the requiring filing — the alcohol license when alcohol is sold
    // (§29.2 founder judgment), the childcare license when children are
    // present — never the other way around. A daycare card must not claim
    // the certificate belongs to an alcohol-license file.
    { factKey: "Q_ALCOHOL_SOLD", factValue: true, documentId: "DOC_ALCOHOL_LICENSE" },
    { factKey: "Q_ALCOHOL_SERVED", factValue: true, documentId: "DOC_ALCOHOL_LICENSE" },
    { factKey: "Q_ALCOHOL_MANUFACTURED", factValue: true, documentId: "DOC_ALCOHOL_LICENSE" },
    { factKey: "Q_TOBACCO_SOLD", factValue: true, documentId: "DOC_TOBACCO_RETAIL_LICENSE" },
    { factKey: "Q_CHILDREN_PRESENT", factValue: true, documentId: "DOC_CHILDCARE_LICENSE" },
  ], [
    text("Hacienda requires the criminal-record certificate inside the retail alcohol beverage license file.", "Hacienda exige el certificado de antecedentes penales dentro del expediente de la licencia de bebidas alcohólicas al detal."),
    text("Hacienda requires the criminal-record certificate inside the retail alcohol beverage license file.", "Hacienda exige el certificado de antecedentes penales dentro del expediente de la licencia de bebidas alcohólicas al detal."),
    text("Hacienda requires the criminal-record certificate inside the retail alcohol beverage license file.", "Hacienda exige el certificado de antecedentes penales dentro del expediente de la licencia de bebidas alcohólicas al detal."),
    text("Hacienda requires the criminal-record certificate inside the retail cigarette dealer license file.", "Hacienda exige el certificado de antecedentes penales dentro del expediente de la licencia de detallista de cigarrillos."),
    text("Establishments that care for or educate children must clear their staff with criminal-record checks as part of their licensing.", "Los establecimientos que cuidan o educan niños tienen que depurar a su personal con verificaciones de antecedentes penales como parte de su licenciamiento."),
    text("Childcare and education businesses must clear their staff with criminal-record checks as part of their licensing.", "Los negocios de cuido y educación tienen que depurar a su personal con verificaciones de antecedentes penales como parte de su licenciamiento."),
    text("Childcare and education businesses must clear their staff with criminal-record checks as part of their licensing.", "Los negocios de cuido y educación tienen que depurar a su personal con verificaciones de antecedentes penales como parte de su licenciamiento."),
    text("Childcare and education businesses must clear their staff with criminal-record checks as part of their licensing.", "Los negocios de cuido y educación tienen que depurar a su personal con verificaciones de antecedentes penales como parte de su licenciamiento."),
    text("Childcare and education businesses must clear their staff with criminal-record checks as part of their licensing.", "Los negocios de cuido y educación tienen que depurar a su personal con verificaciones de antecedentes penales como parte de su licenciamiento."),
    text("Childcare and education businesses must clear their staff with criminal-record checks as part of their licensing.", "Los negocios de cuido y educación tienen que depurar a su personal con verificaciones de antecedentes penales como parte de su licenciamiento."),
    text("Childcare and education businesses must clear their staff with criminal-record checks as part of their licensing.", "Los negocios de cuido y educación tienen que depurar a su personal con verificaciones de antecedentes penales como parte de su licenciamiento."),
    text("Security contractors must clear their personnel with criminal-record checks as part of their licensing.", "Los contratistas de seguridad tienen que depurar a su personal con verificaciones de antecedentes penales como parte de su licenciamiento."),
  ]),
  // REG-GUIDE-CHILDCARE-001 (2026-09-22 QA, live S127): the Childcare /
  // Education License card rendered the unvalidated-description placeholder
  // on live daycare filings. Validated concept grounded in Ley 173-2016
  // (primary: bvirtual.ogp.pr.gov Cuido PDF) and the official Departamento
  // de la Familia licensing office (SULME). The license is the legal
  // permission to care for children in a facility — never assumed, never
  // bundled into the health-permit or background-check cards.
  DOC_CHILDCARE_LICENSE: concept("DOC_CHILDCARE_LICENSE", [
    [condition("businessType", "Childcare/Daycare", "Cuido/educación", "BT_DAYCARE")],
    [condition("Q_CHILDREN_PRESENT", "Children present at the business: Yes", "Niños presentes en el negocio: Sí", true)],
  ], [PR_GUIDANCE_SOURCES.childcareLicensing], [
    text("Puerto Rico licenses childcare, development and learning establishments under Ley 173-2016: the Departamento de la Familia's Oficina de Licenciamiento (SULME) must license a daycare center before it opens, and that childcare license — issued for a specific site, non-transferable, valid up to two years — is the legal permission to care for children in a facility.", "Puerto Rico licencia los establecimientos de cuido, desarrollo y aprendizaje bajo la Ley 173-2016: la Oficina de Licenciamiento del Departamento de la Familia (SULME) tiene que licenciar un centro de cuido antes de que abra, y esa licencia de cuido —expedida para un local específico, intransferible, vigente hasta dos años— es el permiso legal para cuidar niños en una facilidad."),
    text("The childcare license certifies that the daycare meets Puerto Rico's childcare standards — cleared and qualified staff, safe facilities, and approved child-to-staff ratios — and it must be displayed where families can see it.", "La licencia de cuido certifica que el centro cumple los estándares de cuido de Puerto Rico —personal depurado y cualificado, facilidades seguras y proporciones niño-adulto aprobadas— y tiene que exhibirse donde las familias la vean."),
    text("Apply for the childcare license through the Oficina de Licenciamiento (SULME) before opening: file the licensing application with staff background clearances, staff health certificates, staff qualifications, and the facility details, then display the issued daycare license publicly.", "Solicita la licencia de cuido en la Oficina de Licenciamiento (SULME) antes de abrir: radica la solicitud con las verificaciones de antecedentes del personal, certificados de salud, cualificaciones y los detalles del local, y luego exhibe la licencia de cuido expedida a la vista del público."),
    text("Operating a daycare without the childcare license is unlawful and exposes the operator to enforcement from the Departamento de la Familia; the license lasts no more than two years and must be renewed before it expires.", "Operar un centro de cuido sin la licencia de cuido es ilegal y expone al operador a acciones del Departamento de la Familia; la licencia dura hasta dos años y tiene que renovarse antes de vencer."),
  ]),
  DOC_EIN: concept("DOC_EIN", [[employee]], [PR_GUIDANCE_SOURCES.ein], [
    text("The IRS identifies a business by its Employer Identification Number (EIN). Employers need one for employment-tax reporting, and most registered entities need one as well.", "El IRS identifica a un negocio por su Número de Identificación Patronal (EIN). Los patronos lo necesitan para informar contribuciones sobre el empleo, y la mayoría de las entidades registradas también."),
    text("IRS confirmation is official evidence of the EIN assigned to the business, not the application for that number.", "La confirmación del IRS es evidencia oficial del EIN asignado al negocio, no la solicitud de ese número."),
    // Status-neutral next action (concepts are shared across business
    // statuses and the EIN card renders with VERIFY EXISTING on operating
    // businesses — REG-GUIDE-VERIFY-001, 2026-09-21 QA): lead with the
    // upload; the SS-4 application is the alternative for businesses that do
    // not have an EIN yet (the 590603a lesson).
    text("Upload the IRS EIN confirmation (CP 575 notice or other accepted IRS confirmation). If the business does not have an EIN yet, prepare the SS-4 application — a new entity must be formed before it can apply for an EIN.", "Sube la confirmación del EIN del IRS (aviso CP 575 u otra confirmación aceptada). Si el negocio aún no tiene EIN, prepara la solicitud SS-4 — una entidad nueva tiene que estar constituida antes de solicitar el EIN."),
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
    // REG-DACO-REPAIR-001 (2026-09-20 QA): the bundled question's unqualified
    // "repair" invited an honest Yes from a device-repair franchise (live
    // S77, Arecibo) — and previously from an auto repair shop (live S7,
    // 2026-09-17, fixed by BT exclusion). The question now scopes all four
    // service terms to buildings/structures; the trigger label matches the
    // question actually asked. (The validated regulatory reason below is
    // untouched.)
    [condition("Q_OFFERS_CONSTRUCTION_SERVICES", "Offers construction, installation, repair, or contracting services to others on buildings or structures", "Ofrece construcción, instalación, reparación o contratación a terceros en edificios o estructuras", true)],
    [condition("businessType", "General contractor", "Contratista general", "BT_GENERAL_CONTRACTOR")],
    [condition("businessType", "Specialty trade contractor", "Contratista de oficio especializado", "BT_SPECIALTY_TRADE_CONTRACTOR")],
    [condition("businessType", "Construction government contractor", "Contratista de construcción del gobierno", "BT_CONSTRUCTION_GOVERNMENT_CONTRACTOR")],
  ], [PR_GUIDANCE_SOURCES.daco], [
    text("Businesses that offer construction, installation, repair, or contracting services on property they do not own need DACO contractor certification before advertising or submitting estimates.", "Los negocios que ofrecen construcción, instalación, reparación o contratación en propiedad que no es suya necesitan la certificación de contratista de DACO antes de anunciarse o someter estimados."),
    text("Manufacturing or textile-recycling alone does not trigger DACO contractor registration — only when the business also offers contracting services to others.", "Manufactura o reciclaje textil por sí solos no activan el registro de contratistas de DACO — solo cuando el negocio también ofrece servicios de contratación a terceros."),
    text("SmartPR prepares the official DACOUC01 application (page-1 fields) and a supporting-documents checklist for the filing package.", "SmartPR prepara la solicitud oficial DACOUC01 (campos de la página 1) y una lista de documentos de apoyo para el paquete de radicación."),
    text("Inscription is renewed annually under Ley 146-1995; keep the bond and DACO certification current.", "La inscripción se renueva anualmente bajo la Ley 146-1995; mantén la fianza y la certificación de DACO al día."),
  ]),
  // REG-DEALER-DACO-001 (2026-09-25 QA): DACO dealer-license concept for
  // car dealerships. Existence verified on daco.pr.gov/consumidores
  // (Registro Único de Dealers, DACO + DTOP; dealers must hold a DACO
  // license to operate). Application form/fee/reglamento number NOT yet
  // verified — the concept stays at what the primary source confirms and
  // points at the registry page; see CONTENT_REQUIRES_RESEARCH follow-up.
  DOC_DACO_DEALER_LICENSE: concept("DOC_DACO_DEALER_LICENSE", [
    [condition("businessType", "Car dealership", "Dealer de autos", "BT_CAR_DEALERSHIP")],
  ], [PR_GUIDANCE_SOURCES.daco], [
    text("Motor-vehicle dealers in Puerto Rico must hold a DACO license to operate; DACO and DTOP share the Registro Único de Dealers.", "Los dealers de vehículos de motor en Puerto Rico deben tener licencia de DACO para operar; DACO y DTOP comparten el Registro Único de Dealers."),
    text("This is the dealership's operating license — distinct from registering individual vehicles (marbete) or forming the business entity.", "Esta es la licencia de operación del dealer — distinta del registro de vehículos individuales (marbete) o de la constitución de la entidad."),
    text("The Registro Único lists each dealer's surety-bond company and policy number; have bond documentation ready when applying for the DACO license.", "El Registro Único lista la afianzadora y el número de póliza de cada dealer; ten lista la documentación de fianza al solicitar la licencia de DACO."),
    text("Confirm the dealership's license appears in the Registro Único before opening for sales.", "Confirma que la licencia del dealer aparezca en el Registro Único antes de abrir para ventas."),
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
  DOC_ARTICLES_ORGANIZATION: concept("DOC_ARTICLES_ORGANIZATION", [[condition("entityType", "Entity: Puerto Rico LLC", "Entidad: LLC de Puerto Rico", "limited_liability_company")]], [PR_GUIDANCE_SOURCES.entityLlc], [
    text("Selecting an LLC structure does not create the company. Puerto Rico forms an LLC through a Certificate of Organization.", "Elegir la estructura LLC no crea la compañía. Puerto Rico constituye una LLC mediante un Certificado de Organización."),
    text("The formation document establishes the limited liability company with the Department of State.", "El documento de constitución establece la compañía de responsabilidad limitada ante el Departamento de Estado."),
    text("Complete the Certificate of Organization with the company, address and resident-agent details. If already formed, provide the existing formation evidence.", "Completa el Certificado de Organización con los datos de compañía, dirección y agente residente. Si ya está constituida, aporta la evidencia existente."),
    text("After formation is accepted, use the LLC's legal identity for EIN, tax and licensing applications; a completed draft is not formation.", "Tras aceptarse la constitución, usa la identidad legal de la LLC en solicitudes de EIN, contribuciones y licencias; un borrador no constituye la entidad."),
  ]),
  // REG-GUIDE-FORMATION-001 (2026-09-17 QA): the Certificate of Incorporation
  // and LLC Certificate of Organization cards rendered placeholder copy on a
  // Bayamón contractor filing where the entity type was still unknown.
  // Content is deliberately form-conditional — it explains what each filing
  // does if that legal form is chosen, without presuming the choice.
  DOC_CERT_INCORPORATION: concept("DOC_CERT_INCORPORATION", [[business]], [PR_GUIDANCE_SOURCES.entityCorp], [
    text("A Puerto Rico corporation comes into existence when the Department of State accepts its Certificate of Incorporation; choosing a corporate structure in a plan does not create the entity.", "Una corporación en Puerto Rico nace cuando el Departamento de Estado acepta su Certificado de Incorporación; elegir la estructura corporativa en un plan no crea la entidad."),
    text("The Certificate of Incorporation is the formation document that creates the corporation as a legal person before the Department of State.", "El Certificado de Incorporación es el documento de constitución que crea la corporación como persona jurídica ante el Departamento de Estado."),
    text("If forming a corporation, prepare the Certificate of Incorporation with the corporate name, purpose, shares, and resident agent, then file it with the Department of State. If the entity is already formed, provide the existing certificate.", "Si vas a formar una corporación, prepara el Certificado de Incorporación con el nombre corporativo, propósito, acciones y agente residente, y radícalo en el Departamento de Estado. Si la entidad ya está formada, aporta el certificado existente."),
    text("An accepted Certificate of Incorporation gives the corporation its legal identity for EIN, tax, and licensing steps; an unfiled draft is not a formed entity.", "Un Certificado de Incorporación aceptado le da a la corporación su identidad legal para los trámites de EIN, contribuciones y licencias; un borrador sin radicar no es una entidad formada."),
  ]),
  DOC_CERT_ORGANIZATION: concept("DOC_CERT_ORGANIZATION", [[business]], [PR_GUIDANCE_SOURCES.entityLlc], [
    text("The LLC becomes a separate legal person only after the Department of State records its Certificate of Organization — operating under an LLC name before that changes nothing legally.", "La LLC existe como persona jurídica aparte solo después de que el Departamento de Estado registre su Certificado de Organización — operar bajo el nombre de la LLC antes de eso no cambia nada legalmente."),
    text("The Certificate of Organization is the filing that brings the limited liability company into legal existence in Puerto Rico, recorded with the Department of State.", "El Certificado de Organización es la radicación que le da existencia legal a la compañía de responsabilidad limitada en Puerto Rico, registrada ante el Departamento de Estado."),
    text("Draft the certificate with the LLC's name, registered office, and resident agent, then file it with the Department of State; keep the stamped acceptance as the formation proof.", "Prepara el certificado con el nombre de la LLC, la oficina registrada y el agente residente, y radícalo en el Departamento de Estado; conserva la aceptación ponchada como prueba de constitución."),
    text("Once recorded, the LLC can obtain its EIN and enter contracts in its own name; until then the owners act in their personal capacity.", "Una vez registrado, la LLC puede sacar su EIN y contratar en su propio nombre; hasta entonces los dueños actúan a título personal."),
  ]),
  // REG-FOREIGN-AUTH-001 (2026-09-27 QA): DOC_FOREIGN_CORPORATION_AUTHORIZATION
  // existed in the KB with a statute-confidence citation (Ley 164-2009 Art.
  // 13.01) but no rule fired it and no guidance concept covered it. Grounded
  // in the KB's own verified fields: the CORPREG03 official form PDF and the
  // certificate-of-existence-from-home-jurisdiction filing requirement.
  DOC_FOREIGN_CORPORATION_AUTHORIZATION: concept("DOC_FOREIGN_CORPORATION_AUTHORIZATION", [[condition("entityType", "Entity: Foreign Corporation", "Entidad: Corporación extranjera", "foreign_corporation")]], [PR_GUIDANCE_SOURCES.entityForeign], [
    text("A corporation formed outside Puerto Rico does not re-incorporate in PR; it obtains a Certificate of Authorization from the Department of State before doing business in Puerto Rico (Ley 164-2009, Art. 13.01).", "Una corporación constituida fuera de Puerto Rico no se reincorpora en PR; obtiene un Certificado de Autorización del Departamento de Estado antes de hacer negocios en Puerto Rico (Ley 164-2009, Art. 13.01)."),
    text("The certificate of authorization is the corporation's PR operating authority — distinct from registering with Hacienda, obtaining an EIN, or the municipal patent.", "El certificado de autorización es la autoridad operativa de la corporación en PR — distinta del registro ante Hacienda, el EIN o la patente municipal."),
    text("The application (Form CORPREG03) requires a certificate of existence (good standing) from the corporation's home jurisdiction, attached to the filing.", "La solicitud (Formulario CORPREG03) requiere un certificado de existencia (good standing) de la jurisdicción de origen de la corporación, adjunto a la radicación."),
    text("An existing foreign corporation already operating in PR verifies its current certificate rather than filing anew.", "Una corporación extranjera que ya opera en PR verifica su certificado vigente en lugar de radicar uno nuevo."),
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
  // REG-GUIDE-WITHHOLDING-001 (2026-09-17 QA): the REQUIRED
  // DOC_HACIENDA_EMPLOYER_WITHHOLDING card rendered the
  // unvalidated-description placeholder on a Bayamón contractor filing.
  DOC_HACIENDA_EMPLOYER_WITHHOLDING: concept("DOC_HACIENDA_EMPLOYER_WITHHOLDING", [[employee]], [PR_GUIDANCE_SOURCES.withholding], [
    text("Employers in Puerto Rico must withhold income tax from employee wages and remit it to Hacienda; the withholding obligation is registered and managed through SURI.", "Los patronos en Puerto Rico deben retener la contribución sobre ingresos de los salarios de sus empleados y remitirla a Hacienda; la obligación de retención se registra y maneja en SURI."),
    text("The employer withholding registration identifies the business as a withholding agent for Puerto Rico payroll taxes inside SURI.", "El registro de retención patronal identifica al negocio como agente retenedor para las contribuciones sobre nómina dentro de SURI."),
    text("Register as an employer withholding agent in SURI and use the assigned account for wage-withholding deposits and filings.", "Regístrate como agente retenedor patronal en SURI y usa la cuenta asignada para los depósitos y radicaciones de retención de salarios."),
    text("Withholding deposits and filings keep payroll tax compliance current; failing to withhold exposes the employer to penalties and interest.", "Los depósitos y radicaciones de retención mantienen la nómina al día con Hacienda; no retener expone al patrono a penalidades e intereses."),
  ]),



  DOC_HEALTH_PERMIT: concept("DOC_HEALTH_PERMIT", [[condition("Q_FOOD_PREPARED", "Food prepared on site", "Alimentos preparados en el local", true)], [condition("Q_FOOD_SOLD", "Food sold on site", "Alimentos vendidos en el local", true)], [business]], [PR_GUIDANCE_SOURCES.health], [
    // REG-GUIDE-HEALTH-001 (2026-09-17 21:00 QA, S23 Bayamón barbershop):
    // this concept fires for restaurants AND personal-care premises
    // (barbershops, salons, spas, tattoo shops) and lodging — the lead
    // sentence must not define the sanitary permit as a food-handling
    // thing. Food preparation is one example of the inspected activity,
    // not its scope. Same defect class as the solar-only construction
    // guidance (10c5a75) and the food-only fire certification (7761507).
    text("Establishments that handle food or serve the public in person are subject to sanitary inspection under Departamento de Salud environmental-health regulation before they may operate — for example restaurants and other food establishments, and personal-care premises such as barbershops, salons, and spas.", "Los establecimientos que manejan alimentos o atienden al público en persona están sujetos a inspección sanitaria bajo la reglamentación de salud ambiental del Departamento de Salud antes de operar — por ejemplo restaurantes y otros establecimientos de alimentos, y locales de cuidado personal como barberías, salones y spas."),
    text("The sanitary/health permit documents that the premises passed inspection for its activity category — food handling, personal-care services, or other public-facing use.", "El permiso sanitario acredita que el local aprobó la inspección para su categoría de actividad — manejo de alimentos, servicios de cuidado personal u otro uso de atención al público."),
    // Live QA 2026-09-19 03:00 (S54, Trujillo Alto gas station): "submit the
    // permit application" told a 15-year existing operator to file a new
    // application on a VERIFY EXISTING card. Same status-blind-copy class
    // as the EIN fix (2026-09-17) and the transport-permit fix (this
    // cycle): concepts are shared across business statuses, so the next
    // action must read correctly for both applicants and existing holders.
    text("Prepare the premises for a Departamento de Salud sanitary inspection and submit the permit application for the activity category the business will operate — or confirm the existing sanitary permit is current.", "Prepara el local para la inspección sanitaria del Departamento de Salud y presenta la solicitud del permiso para la categoría de actividad que operará el negocio — o confirma que el permiso sanitario vigente está al día."),
    text("An issued sanitary permit authorizes the inspected activity at that location, subject to its conditions and renewal.", "El permiso sanitario emitido autoriza la actividad inspeccionada en ese local, sujeto a sus condiciones y renovación."),
  ]),
  DOC_FIRE_CERT: concept("DOC_FIRE_CERT", [[condition("Q_FOOD_PREPARED", "Food prepared on site", "Alimentos preparados en el local", true)], [business]], [PR_GUIDANCE_SOURCES.fire], [
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
  DOC_CFPM: concept("DOC_CFPM", [[condition("Q_FOOD_PREPARED", "Food prepared on site", "Alimentos preparados en el local", true)], [business]], [PR_GUIDANCE_SOURCES.cfpm], [
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

  DOC_LUMA_INTERCONNECTION: concept("DOC_LUMA_INTERCONNECTION", [[condition("Q_RENEWABLE_INSTALL", "Has or will install a renewable energy system", "Tiene o instalará un sistema de energía renovable", true)], [business]], [PR_GUIDANCE_SOURCES.luma], [
    text("A grid-connected solar system must be registered with LUMA Energy before it can legally operate. LUMA's interconnection review covers the system's technical requirements for parallel operation with the grid.", "Un sistema solar conectado a la red tiene que estar registrado con LUMA Energy antes de poder operar legalmente. La revisión de interconexión de LUMA cubre los requisitos técnicos para operar en paralelo con la red."),
    text("The interconnection registration is LUMA's record of the distributed generation system and its approval to connect, not the OGPe construction permit and not permission to operate.", "El registro de interconexión es el expediente de LUMA del sistema de generación distribuida y su aprobación para conectarse; no es el permiso de construcción de OGPe ni el permiso para operar."),
    text("Complete LUMA's interconnection registration with the system specifications and installer information. If the project needs an OGPe construction permit, finish OGPe first — LUMA requires the approved OGPe use permit before it processes the interconnection.", "Completa el registro de interconexión de LUMA con las especificaciones del sistema y la información del instalador. Si el proyecto necesita permiso de construcción de OGPe, termina OGPe primero — LUMA exige el permiso de uso aprobado de OGPe antes de tramitar la interconexión."),
    text("LUMA's interconnection approval authorizes the system to connect; the system still needs LUMA's Permission to Operate before it is switched on.", "La aprobación de interconexión de LUMA autoriza conectar el sistema; el sistema todavía necesita el Permiso para Operar de LUMA antes de encenderse."),
  ]),
  DOC_NET_METERING_AGREEMENT: concept("DOC_NET_METERING_AGREEMENT", [[condition("Q_RENEWABLE_INSTALL", "Has or will install a renewable energy system", "Tiene o instalará un sistema de energía renovable", true)], [business]], [PR_GUIDANCE_SOURCES.netMetering], [
    text("Commercial solar systems that export surplus energy to the grid operate under LUMA's interconnection and net metering agreement, which sets the metering and compensation terms.", "Los sistemas solares comerciales que exportan el excedente de energía a la red operan bajo el acuerdo de interconexión y medición neta de LUMA, que establece los términos de medición y compensación."),
    text("The net metering agreement documents the terms for parallel operation and exported-energy metering; it is not the interconnection registration itself and not permission to operate.", "El acuerdo de medición neta documenta los términos de operación en paralelo y medición de la energía exportada; no es el registro de interconexión ni el permiso para operar."),
    text("Execute LUMA's interconnection / net metering agreement for the commercial customer account tied to the installation address.", "Firma el acuerdo de interconexión y medición neta de LUMA para la cuenta comercial del cliente atada a la dirección de la instalación."),
    text("A countersigned agreement locks in the net metering terms for the system; keep it with the interconnection file until LUMA grants Permission to Operate.", "Un acuerdo firmado por ambas partes fija los términos de medición neta del sistema; consérvalo con el expediente de interconexión hasta que LUMA otorgue el Permiso para Operar."),
  ]),
  DOC_OGPE_CONSTRUCTION_PERMIT: concept("DOC_OGPE_CONSTRUCTION_PERMIT", [[condition("project_type", "Construction or renovation project", "Proyecto de construcción o remodelación")], [condition("Q_SOLAR_MOUNTING", "Ground-mounted solar system", "Sistema solar instalado en el suelo", "Ground-mounted")], [condition("Q_SOLAR_SIZE", "System over 1 MW", "Sistema de más de 1 MW", "Over 1 MW")]], [PR_GUIDANCE_SOURCES.ogpeConstruction], [
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
  // REG-GUIDE-VEHICLE-001 (2026-09-17 QA): commercial-vehicle registration
  // cards rendered the unvalidated-description placeholder (flagged in the
  // 2026-09-17 03:00 cycle). The document cites Law 22-2000 Art. 23.01 at
  // statute confidence, so a validated concept is written here from that
  // basis — no invented procedure.
  // REG-GUIDE-VEHICLE-002 (2026-09-18 QA, live S29): the business_type
  // rules (RULE_0178–RULE_0216, RULE_0690) fire the document without any
  // Q_COMMERCIAL_VEHICLES answer, so the card hedged "not confirmed yet"
  // under a VERIFY EXISTING badge. The business type is the honest trigger
  // for those rules — it now explains the match alongside the Q&A path.
  DOC_VEHICLE_REGISTRATION: concept("DOC_VEHICLE_REGISTRATION", [[condition("Q_COMMERCIAL_VEHICLES", "Commercial vehicles used", "Se usan vehículos comerciales", true)], [business]], [PR_GUIDANCE_SOURCES.dtop], [
    text("Vehicles used in a commercial operation in Puerto Rico must be registered with DTOP and carry the current annual registration sticker (marbete) under Law 22-2000, Art. 23.01.", "Los vehículos que se usan en una operación comercial en Puerto Rico tienen que estar registrados en el DTOP y tener al día el marbete anual, según la Ley 22-2000, Art. 23.01."),
    text("The vehicle registration documents that that specific vehicle is authorized for road use with its registration current — it does not license the business activity itself.", "El registro de un vehículo comercial acredita que ese vehículo en particular está autorizado para transitar con su registro y marbete al día — no licencia la actividad del negocio por sí solo."),
    text("Verify each commercial vehicle the business runs is registered with DTOP and its marbete is current; handle registrations, renewals, and transfers through CESCO.", "Verifica que cada vehículo comercial que opere el negocio esté registrado en el DTOP y tenga el marbete al día; gestiona los registros, renovaciones y traspasos en CESCO."),
    text("An unregistered commercial vehicle cannot legally operate on public roads; keep each vehicle the business runs current on registration and marbete.", "Un vehículo comercial sin registrar no puede operar legalmente en las vías públicas; mantén al día el registro y el marbete de cada vehículo que opere el negocio."),
  ]),
  // REG-GUIDE-AMBULANT-001 (2026-10-06 QA): the Municipal Ambulant-Business
  // License card rendered the unvalidated-description placeholder on a live
  // Toa Baja food-truck filing (S454) while citing a genuine statute
  // (Ley 81-1991, Art. 20.003, 21 L.P.R.A. § 4952 — verified 2026-10-06 via
  // LexJuris compiled statute text). Municipalities regulate ambulant
  // businesses' location and operation and issue the license, so the card
  // now carries validated content instead of the "hasn't validated" caveat.
  DOC_AMBULANT_BUSINESS_LICENSE: concept("DOC_AMBULANT_BUSINESS_LICENSE", [
    [condition("businessType", "Food Truck", "Food truck", "BT_FOOD_TRUCK")],
    [business],
  ], [PR_GUIDANCE_SOURCES.ambulant], [
    text("Puerto Rico's municipalities regulate where ambulant (mobile) businesses may locate and operate within their territorial limits, and each municipality may issue, deny, suspend, revoke, amend or modify the licenses for any ambulant business (Ley 81-1991, Art. 20.003, 21 L.P.R.A. § 4952).", "Los municipios de Puerto Rico reglamentan la ubicación y operación de los negocios ambulantes dentro de sus límites territoriales, y cada municipio puede expedir, denegar, suspender, revocar, enmendar o modificar las licencias para cualquier negocio ambulante (Ley 81-1991, Art. 20.003, 21 L.P.R.A. § 4952)."),
    text("The municipal ambulant business license authorizes the mobile unit to operate — park, set up and sell — in that municipality, on the terms, locations and hours the municipal ordinance allows.", "La licencia municipal de negocio ambulante autoriza a la unidad móvil a operar — estacionarse, ubicarse y vender — en ese municipio, bajo los términos, ubicaciones y horarios que permita la ordenanza municipal."),
    text("Check with the municipality where the unit will operate which ambulant business license and periodic fee apply, and what location, hours and health-and-sanitation rules the municipal ordinance sets; each license type is valid for up to one year, so plan renewals.", "Verifica con el municipio donde operará la unidad qué licencia de negocio ambulante y qué canon periódico aplican, y qué reglas de ubicación, horario y salubridad establece la ordenanza municipal; cada tipo de licencia es válida por hasta un año, así que planifica las renovaciones."),
    text("Operating without the municipal ambulant business license can lead the municipality to intervene and order the unit to stop operating until the license is in place.", "Operar sin la licencia municipal de negocio ambulante puede llevar al municipio a intervenir y ordenar que la unidad cese operaciones hasta tener la licencia."),
  ]),
  // REG-GUIDE-USEDOIL-001 (2026-10-06 QA): the DRNA Used-Oil Generator
  // Identification card rendered the unvalidated-description placeholder on
  // a live Toa Baja auto-repair filing (S467) while citing a genuine statute
  // (Ley 172-1996; Reglamento 5717 Cap. VII — verified 2026-10-06 via the
  // OGP-compiled statute PDF). Shops that generate used oil must manage it
  // through authorized handlers, so the card now carries validated content
  // instead of the "hasn't validated" caveat. Conditions cover every firing
  // path: the auto-repair business type (RULE_0679/0680), the vehicle-repair
  // and hazardous-fluids questions, plus the generic businessType fallback.
  DOC_USED_OIL_GENERATOR_ID: concept("DOC_USED_OIL_GENERATOR_ID", [
    [condition("businessType", "Auto Repair Shop", "Taller de mecánica", "BT_AUTO_REPAIR_SHOP")],
    [condition("Q_VEHICLE_REPAIR", "Vehicle repair: Yes", "Reparación de vehículos: Sí", true)],
    [condition("Q_HAZARDOUS_FLUIDS", "Hazardous fluids: Yes", "Fluidos peligrosos: Sí", true)],
    [business],
  ], [PR_GUIDANCE_SOURCES.usedOil], [
    text("Puerto Rico's used-oil law (Ley 172-1996, the \"Ley para el Manejo Adecuado de Aceite Usado en Puerto Rico\") prohibits dumping used oil on the ground, in sewers or septic tanks, or in any water body, and requires its proper collection, recovery and disposal — shops that generate used oil (oil changes, transmission service) must manage it through authorized handlers (Reglamento 5717, Cap. VII).", "La Ley 172-1996 (\"Ley para el Manejo Adecuado de Aceite Usado en Puerto Rico\") prohíbe botar aceite usado en el terreno, en alcantarillados o pozos sépticos, o en cualquier cuerpo de agua, y exige su recogido, recuperación y disposición adecuada — los talleres que generan aceite usado (cambios de aceite, servicio de transmisión) tienen que manejarlo con transportistas autorizados (Reglamento 5717, Cap. VII)."),
    text("The DRNA used-oil generator identification registers the business as a generator of used oil so the oil is tracked from generation to proper disposal or recycling.", "La identificación de generador de aceite usado del DRNA registra al negocio como generador de aceite usado para que el aceite se rastree desde su generación hasta su disposición o reciclaje adecuado."),
    text("Confirm with DRNA whether your volume of used oil requires generator identification, arrange pickup by an authorized used-oil transporter, and keep the pickup receipts on file.", "Confirma con el DRNA si tu volumen de aceite usado requiere la identificación de generador, coordina el recogido con un transportista de aceite usado autorizado, y guarda los recibos de recogido."),
    text("Dumping used oil on the ground or into drains can lead to DRNA enforcement action and cleanup liability.", "Botar aceite usado en el terreno o por el desagüe puede llevar a acción de fiscalización del DRNA y a responsabilidad por la limpieza."),
  ]),
  // REG-GUIDE-USEDOIL-001 (2026-10-06 QA): the EPA/DRNA Hazardous-Waste
  // Generator ID card rendered the "confirm with the agency" placeholder on
  // the same live S467 filing while citing a genuine statute pair (RCRA
  // 40 CFR 262; Ley 70-1992 — EPA summary page verified 200 OK 2026-10-06).
  // Conditions cover every firing path: the auto-repair business type
  // (RULE_0681/0682), the hazardous-materials and hazardous-fluids
  // questions, plus the generic businessType fallback.
  DOC_EPA_HAZARDOUS_WASTE_ID: concept("DOC_EPA_HAZARDOUS_WASTE_ID", [
    [condition("businessType", "Auto Repair Shop", "Taller de mecánica", "BT_AUTO_REPAIR_SHOP")],
    [condition("Q_HAZARDOUS_MATERIALS", "Hazardous materials: Yes", "Materiales peligrosos: Sí", true)],
    [condition("Q_HAZARDOUS_FLUIDS", "Hazardous fluids: Yes", "Fluidos peligrosos: Sí", true)],
    [business],
  ], [PR_GUIDANCE_SOURCES.hazmat], [
    text("Under RCRA, businesses that generate hazardous waste must obtain an EPA identification number and manage the waste under the generator standards (40 CFR Part 262); in Puerto Rico the DRNA administers the local program under the island's waste framework (Ley 70-1992).", "Bajo RCRA, los negocios que generan desperdicios peligrosos tienen que obtener un número de identificación de la EPA y manejarlos según las normas para generadores (40 CFR Parte 262); en Puerto Rico el DRNA administra el programa local bajo el marco de desperdicios de la isla (Ley 70-1992)."),
    text("The EPA/DRNA hazardous-waste generator ID registers the business as a generator so its hazardous waste is tracked from generation to disposal.", "El ID de generador de desperdicios peligrosos de la EPA/DRNA registra al negocio como generador para que sus desperdicios peligrosos se rastreen desde su generación hasta su disposición."),
    text("Determine whether your waste streams (solvents, paints, contaminated fluids) count as hazardous under RCRA; if they do, obtain the generator ID through the EPA's RCRAInfo system and follow the storage, labeling and manifest rules for your generator category.", "Determina si tus corrientes de desperdicios (solventes, pinturas, fluidos contaminados) cuentan como peligrosos bajo RCRA; si es así, obtén el ID de generador por el sistema RCRAInfo de la EPA y sigue las reglas de almacenaje, etiquetado y manifiestos de tu categoría de generador."),
    text("Generating hazardous waste without the required identification and manifests can lead to EPA/DRNA enforcement and penalties.", "Generar desperdicios peligrosos sin la identificación y los manifiestos requeridos puede llevar a fiscalización y multas de la EPA/DRNA."),
  ]),
  // REG-GUIDE-TRANSPORT-001 (2026-09-18 QA): the Transportation / PUC Permit
  // card rendered the unvalidated-description placeholder on a Bayamón
  // trucking-company filing. Conditions cover every firing path: the
  // business-type rules (RULE_0177/0179/0181/0183/0185/0187/0189/0268/0518),
  // the commercial-vehicles question (RULE_0022), and the hazmat-transport
  // question (RULE_0618). The generic businessType group is the honest
  // fallback when the intake stores the display name rather than the BT id.
  DOC_TRANSPORT_PERMIT: concept("DOC_TRANSPORT_PERMIT", [
    [condition("businessType", "Trucking company", "Compañía de acarreo", "BT_TRUCKING_COMPANY")],
    [condition("businessType", "Courier service", "Servicio de mensajería", "BT_COURIER_SERVICE")],
    [condition("businessType", "Moving company", "Compañía de mudanzas", "BT_MOVING_COMPANY")],
    [condition("businessType", "Taxi service", "Servicio de taxi", "BT_TAXI_SERVICE")],
    [condition("businessType", "Freight forwarding company", "Compañía de reexpedición de carga", "BT_FREIGHT_FORWARDING_COMPANY")],
    [condition("businessType", "Logistics company", "Compañía de logística", "BT_LOGISTICS_COMPANY")],
    [condition("businessType", "Car rental business", "Negocio de alquiler de carros", "BT_CAR_RENTAL_BUSINESS")],
    [condition("businessType", "Warehouse operator", "Operador de almacén", "BT_WAREHOUSE_OPERATOR")],
    [condition("Q_COMMERCIAL_VEHICLES", "Commercial vehicles: Yes", "Vehículos comerciales: Sí", true)],
    [condition("Q_HAZMAT_TRANSPORT", "Hazardous materials transport: Yes", "Transporte de materiales peligrosos: Sí", true)],
    [business],
  ], [PR_GUIDANCE_SOURCES.ntsp], [
    text("For-hire transportation in Puerto Rico operates under an NTSP franchise: carriers moving goods or passengers for compensation need the Porteador por Contrato franchise under Law 109-1962 and NTSP Regulation 9156 §10.02. Ordinary vehicle registration does not authorize commercial carriage.", "El transporte por paga en Puerto Rico opera bajo franquicia del NTSP: los porteadores que mueven carga o pasajeros por compensación necesitan la franquicia de Porteador por Contrato bajo la Ley 109-1962 y el Reglamento 9156 §10.02 del NTSP. El registro ordinario del vehículo no autoriza el acarreo comercial."),
    text("The NTSP franchise is the operating authority for the transport service: it identifies the carrier, the authorized service, and the terms under which the franchise was granted.", "La franquicia del NTSP es la autorización de operación del servicio de transporte: identifica al porteador, el servicio autorizado y los términos bajo los cuales se otorgó la franquicia."),
    // Live QA 2026-09-19 03:00 (S53, Ponce trucking): "Apply for …" told a
    // 12-year existing operator to apply for a new franchise on a
    // VERIFY EXISTING card. Same status-blind-copy class as the EIN fix
    // (2026-09-17): concepts are shared across business statuses, so the
    // next action must read correctly for both applicants and existing
    // holders ("obtain … or confirm …" rather than "apply for …").
    text("Obtain the Porteador por Contrato franchise through the NTSP at ntsp.pr.gov (many filings are processed through renovacionesonline.com), or confirm the existing franchise is current. Carry proof of the franchise in each commercial vehicle.", "Obtén la franquicia de Porteador por Contrato en el NTSP (ntsp.pr.gov — muchos trámites se procesan por renovacionesonline.com), o confirma que la franquicia vigente está al día. Lleva la evidencia de la franquicia en cada vehículo comercial."),
    text("Operating a for-hire transport service without the NTSP franchise risks fines and enforcement action; an expired franchise leaves the service operating without authority.", "Operar un servicio de transporte por paga sin la franquicia del NTSP arriesga multas y acción de fiscalización; una franquicia vencida deja el servicio operando sin autorización."),
  ]),
  // REG-GUIDE-AGRI-001 (2026-09-18 QA): the Bona Fide Farmer Registration
  // card rendered the unvalidated-description placeholder on an Arecibo
  // coffee-farm filing. Conditions cover every firing path: the
  // business-type rules (RULE_0218–0223) and the agriculture-production
  // question (RULE_0041), plus the generic businessType fallback.
  DOC_AGRICULTURE_REGISTRATION: concept("DOC_AGRICULTURE_REGISTRATION", [
    [condition("businessType", "Farm", "Finca", "BT_FARM")],
    [condition("businessType", "Livestock operation", "Operación ganadera", "BT_LIVESTOCK_OPERATION")],
    [condition("businessType", "Aquaculture operation", "Operación de acuacultura", "BT_AQUACULTURE_OPERATION")],
    [condition("businessType", "Plant nursery", "Vivero de plantas", "BT_PLANT_NURSERY")],
    [condition("businessType", "Agricultural services company", "Compañía de servicios agrícolas", "BT_AGRICULTURAL_SERVICES_COMPANY")],
    [condition("businessType", "Coffee plantation", "Hacienda de café", "BT_COFFEE_PLANTATION")],
    [condition("Q_AGRICULTURE_PRODUCTION", "Agricultural production: Yes", "Producción agrícola: Sí", true)],
    [business],
  ], [PR_GUIDANCE_SOURCES.agricultura], [
    text("Puerto Rico certifies genuine agricultural producers under the Incentives Code: the Certificación de Agricultor Bona Fide, issued by the Secretary of Agriculture under Law 60-2019, identifies the holder as a bona fide farmer. The certification is valid for 4 years.", "Puerto Rico certifica a los productores agrícolas genuinos bajo el Código de Incentivos: la Certificación de Agricultor Bona Fide, expedida por el Secretario de Agricultura bajo la Ley 60-2019, identifica al titular como agricultor bona fide. La certificación tiene una vigencia de 4 años."),
    text("The bona fide farmer certification documents the farm's agricultural status for incentive programs and dealings with the Department of Agriculture.", "La certificación de agricultor bona fide documenta el estatus agrícola de la finca para los programas de incentivos y los trámites ante el Departamento de Agricultura."),
    text("Request the Certificación de Agricultor Bona Fide from the Department of Agriculture — issuance is handled through its regional offices. Renew the certification every 4 years before it expires.", "Solicita la Certificación de Agricultor Bona Fide en el Departamento de Agricultura — la expedición se tramita en sus oficinas regionales. Renueva la certificación cada 4 años antes de que se venza."),
    text("Without a current bona fide certification, the farm cannot access the incentive benefits reserved for certified bona fide farmers.", "Sin una certificación bona fide vigente, la finca no puede acceder a los beneficios de incentivos reservados a los agricultores bona fide certificados."),
  ]),
  // REG-GUIDE-TOURISM-001 (2026-09-18 QA): the PRTC innkeeper registration
  // and room-tax return cards rendered the unvalidated-description
  // placeholder (flagged live 2026-09-18, S42). Conditions cover every
  // firing path: the lodging business-type rules (RULE_0139/0142/0145/0148,
  // 0261–0264, 0601) via the businessType fallback, and the Q&A paths
  // (RULE_0033/0602 Q_SHORT_TERM_RENTAL, RULE_0691 Q_GUESTS_OVERNIGHT).
  DOC_TOURISM_REGISTRATION: concept("DOC_TOURISM_REGISTRATION", [
    [condition("Q_SHORT_TERM_RENTAL", "Short-term rental", "Alquiler a corto plazo", true)],
    [condition("Q_GUESTS_OVERNIGHT", "Guests stay overnight", "Huéspedes se hospedan", true)],
    [business],
  ], [PR_GUIDANCE_SOURCES.tourism], [
    text("Short-term lodging in Puerto Rico — stays of fewer than 90 days — must register with the Compañía de Turismo as an innkeeper (hostelero) and obtain an Innkeeper Identification Number. Registration applies island-wide, in every municipality.", "Los alojamientos de corta duración en Puerto Rico — estadías de menos de 90 días — tienen que registrarse en la Compañía de Turismo como hosteleros y obtener un Número de Identificación de Hostelero. El registro aplica en toda la isla, en cada municipio."),
    text("The innkeeper registration is the Tourism Company's record that the property is authorized to operate as short-term lodging and to collect the room-occupancy tax. It is not the municipal patente and not the merchant registration.", "El registro de hostelero es el expediente de la Compañía de Turismo que autoriza la propiedad a operar como alojamiento de corta duración y a cobrar el impuesto sobre el canon por ocupación de habitación. No es la patente municipal ni el registro de comerciante."),
    text("Register the property as an innkeeper with the Compañía de Turismo and obtain the Innkeeper ID before hosting guests; keep the registration current for the life of the operation.", "Registra la propiedad como hostelero en la Compañía de Turismo y obtén el Número de Identificación de Hostelero antes de recibir huéspedes; mantén el registro al día durante toda la operación."),
    text("An issued innkeeper registration authorizes the property to operate and to collect the room-occupancy tax from guests; the tax collected is reported on the monthly room-tax return.", "Un registro de hostelero emitido autoriza la propiedad a operar y a cobrar el impuesto sobre el canon por ocupación de habitación a los huéspedes; el impuesto cobrado se informa en la declaración mensual del impuesto de habitación."),
  ]),
  DOC_ROOM_TAX_RETURN: concept("DOC_ROOM_TAX_RETURN", [
    [condition("Q_SHORT_TERM_RENTAL", "Short-term rental", "Alquiler a corto plazo", true)],
    [condition("Q_GUESTS_OVERNIGHT", "Guests stay overnight", "Huéspedes se hospedan", true)],
    [business],
  ], [PR_GUIDANCE_SOURCES.roomTax], [
    // REG-GUIDE-ROOMTAX-001 (2026-09-22 QA): the §29.4 founder-settled chain
    // pins "7% room tax" as graph content — the rate now appears in the
    // copy, verified on tourism.pr.gov/room-tax/ (PRTC: "a room occupancy
    // tax equal to 7% of the room's rate").
    text("Short-term lodging operators charge guests a room-occupancy tax of 7% of the room rate (Ley 272-2003) and file the monthly room-tax return with the Compañía de Turismo by the 10th of the following month.", "Los operadores de alojamiento de corta duración cobran a los huéspedes un impuesto sobre el canon por ocupación de habitación del 7% de la tarifa de la habitación (Ley 272-2003) y radican la declaración mensual del impuesto de habitación en la Compañía de Turismo el día 10 del mes siguiente."),
    text("The monthly return reports the 7% room-occupancy tax collected on guest stays. It is separate from the innkeeper registration itself — the registration authorizes the operation; the return accounts for the tax.", "La declaración mensual informa el impuesto sobre el canon por ocupación de habitación del 7% cobrado en las estadías de huéspedes. Es independiente del registro de hostelero — el registro autoriza la operación; la declaración rinde cuentas del impuesto."),
    text("File the monthly room-tax declaration with the Compañía de Turismo by the 10th of each month and pay the room-occupancy tax collected during the prior month.", "Radica la declaración mensual del impuesto de habitación en la Compañía de Turismo el día 10 de cada mes y paga el impuesto sobre el canon por ocupación cobrado durante el mes anterior."),
    text("A filed return keeps the innkeeper account current; operating short-term lodging without filing the monthly return exposes the operator to penalties.", "Una declaración radicada mantiene la cuenta de hostelero al día; operar alojamiento de corta duración sin radicar la declaración mensual expone al operador a penalidades."),
  ]),
  // REG-GUIDE-HOA-001 (2026-09-22 QA): the Condo / HOA Short-Term Rental
  // Authorization card rendered the unvalidated-description placeholder on
  // the live Guaynabo STR filing (S138). Conditions cover the firing path
  // (RULE_0600, Q_HOA_CONDO=true) plus the STR business-type path and the
  // generic businessType fallback (d4940f4 class). Copy stays conditional —
  // the governing documents decide — never a claim of a universal HOA
  // permit.
  DOC_HOA_AUTHORIZATION: concept("DOC_HOA_AUTHORIZATION", [
    [condition("Q_HOA_CONDO", "Condo or HOA property: Yes", "Propiedad en condominio o HOA: Sí", true)],
    [condition("businessType", "Airbnb / Short-Term Rental", "Alquiler a corto plazo (Airbnb)", "BT_AIRBNB_SHORT_TERM_RENTAL")],
    [business],
  ], [PR_GUIDANCE_SOURCES.hoaCondo], [
    text("Puerto Rico's condo law (Ley 129-2020, Art. 40, 31 L.P.R.A § 1922l) addresses short-term rentals directly: a condo unit cannot be prohibited from short-term rental unless the master deed (escritura matriz) or the regulations contain an express prohibition or set a minimum lease term. The regulations may also govern how short-term rentals are conducted — including a minimum number of nights and a special monthly fee on STR owners, capped at the maintenance fee.", "La ley de condominios de Puerto Rico (Ley 129-2020, Art. 40, 31 L.P.R.A § 1922l) atiende los alquileres a corto plazo directamente: no se puede prohibir el alquiler a corto plazo de un apartamento, salvo que la escritura matriz o el reglamento contengan una prohibición expresa o establezcan un término mínimo de arrendamiento. El reglamento también puede regular la forma de los alquileres a corto plazo — incluyendo un mínimo de noches y una cuota mensual especial a los titulares que alquilen a corto plazo, sin exceder la cuota de mantenimiento."),
    text("The condo/HOA short-term-rental authorization is the unit owner's evidence that the unit's short-term-rental use complies with the condominium's governing documents — no express prohibition, no unmet minimum lease term, and the reglamento's rules for short-term rentals observed. It is separate from the Tourism Company innkeeper registration — the innkeeper registration authorizes the lodging operation; the HOA authorization clears the condominium's own rules.", "La autorización de alquiler a corto plazo del condominio/HOA es la evidencia del titular de que el alquiler a corto plazo de la unidad cumple con los documentos del condominio — que no hay una prohibición expresa ni un término mínimo de arrendamiento incumplido, y que se observan las reglas que el reglamento fije para el alquiler a corto plazo. Es independiente del registro de hostelero de la Compañía de Turismo — el registro de hostelero autoriza la operación de alojamiento; la autorización del HOA aclara las reglas propias del condominio."),
    text("Before listing the unit, read the escritura matriz and the reglamento: confirm there is no express prohibition or minimum lease term blocking short-term rental, note any reglamento rules (minimum nights, special fee), and obtain written authorization from the condo board or administrator where the documents require it.", "Antes de publicar la unidad, lee la escritura matriz y el reglamento: confirma que no haya una prohibición expresa ni un término mínimo de arrendamiento que impida el alquiler a corto plazo, toma nota de las reglas del reglamento (mínimo de noches, cuota especial), y obtén autorización escrita de la junta del condominio o del administrador donde los documentos la exijan."),
    text("Renting short-term in violation of an express prohibition or a minimum lease term in the condo documents exposes the owner to enforcement by the Consejo de Titulares — confirm the documents allow the use before taking bookings.", "Alquilar a corto plazo en violación de una prohibición expresa o de un término mínimo de arrendamiento en los documentos del condominio expone al titular a acciones del Consejo de Titulares — confirma que los documentos permiten el uso antes de aceptar reservaciones."),
  ]),
  // REG-GUIDE-ENTERTAINMENT-001 (2026-09-22 QA): the Entertainment Permit
  // card rendered the unvalidated-description placeholder on a live Dorado
  // no-food-bar filing (S139). Conditions cover the firing paths: the live
  // entertainment question (RULE_0032, heuristic + missing
  // entertainment_details) and the entertainment-venue business-type rules
  // (RULE_0245/0246/0247 via the businessType fallback, d4940f4 class).
  // Copy stays conditional — Puerto Rico has no single island-wide
  // entertainment permit, so the card never claims one exists. The
  // municipality's own ordinance decides whether the planned entertainment
  // needs an authorization, and Ley 161-2009 Art. 8.4A folds applicable
  // licenses/authorizations into the OGPe Permiso Único, so the municipal
  // authorization can be routed through the Permiso Único where the
  // municipality handles it that way. The Ley 182-1996 disambiguation is
  // intentional: promoter licensing (promotores de espectáculos públicos,
  // registered at Hacienda) is a separate obligation from a venue's own
  // in-house entertainment, and the card must not conflate them.
  DOC_ENTERTAINMENT_PERMIT: concept("DOC_ENTERTAINMENT_PERMIT", [
    [condition("Q_LIVE_ENTERTAINMENT", "Live entertainment: Yes", "Entretenimiento en vivo: Sí", true)],
    [condition("businessType", "Music Venue", "Local de música", "BT_MUSIC_VENUE")],
    [condition("businessType", "Event Venue", "Salón de eventos", "BT_EVENT_VENUE")],
    [condition("businessType", "Theater", "Teatro", "BT_THEATER")],
    [business],
  ], [PR_GUIDANCE_SOURCES.entertainment161, PR_GUIDANCE_SOURCES.entertainmentPromoterLaw], [
    text("Puerto Rico has no single island-wide entertainment permit. When a business offers live entertainment to the public — a live band or trio, a DJ, variety shows — the municipality where the business operates is the authority that decides, under its own ordenanza, whether the planned entertainment needs an authorization. Ley 161-2009 (Art. 8.4A) folds applicable operating licenses and authorizations into the OGPe Permiso Único, so the municipal entertainment authorization can be routed through the Permiso Único where the municipality handles it that way.", "En Puerto Rico no hay un permiso de entretenimiento único para toda la isla. Cuando un negocio ofrece entretenimiento en vivo al público — una banda o un trío en vivo, un DJ, variedades — es el municipio donde opera el negocio la autoridad que decide, por su propia ordenanza, si el entretenimiento planificado requiere una autorización. La Ley 161-2009 (Art. 8.4A) consolida las licencias y autorizaciones aplicables a la operación en el Permiso Único de OGPe, así que la autorización municipal de entretenimiento puede tramitarse por el Permiso Único donde el municipio la maneje por esa vía."),
    text("The entertainment authorization is the municipality's clearance that the planned entertainment is allowed at that venue under the local rules — it is not a promoter license. Promoters of public shows — the people who organize and sell public events — register and are licensed separately under Ley 182-1996 (Ley del Promotor de Espectáculos Públicos, at the Departamento de Hacienda); a venue hosting its own in-house music is generally not a promoter.", "La autorización de entretenimiento es el visto bueno del municipio de que el entretenimiento planificado se permite en ese local bajo las reglas locales — no es una licencia de promotor. Los promotores de espectáculos públicos — los que organizan y venden eventos públicos — se registran y obtienen licencia por separado bajo la Ley 182-1996 (Ley del Promotor de Espectáculos Públicos, en el Departamento de Hacienda); un local que presenta su propia música en vivo generalmente no es un promotor."),
    text("Ask the municipal permits office (or the mayor's office) what authorization the planned entertainment needs and what the conditions are — the type of act, indoor or outdoor, hours, expected occupancy — and confirm whether it is handled through the Permiso Único or as a separate municipal filing before the entertainment starts.", "Pregunta en la oficina de permisos del municipio (o en la alcaldía) qué autorización necesita el entretenimiento planificado y cuáles son las condiciones — el tipo de acto, bajo techo o al aire libre, los horarios, la ocupación esperada — y confirma si se tramita por el Permiso Único o como una radicación municipal separada antes de empezar el entretenimiento."),
    text("Offering live entertainment without the authorization the municipality requires can lead to fines and shutdown orders; this card stays as \"more information needed\" until the type, setting, and hours of the entertainment — and the municipality's own ordinance — are confirmed.", "Ofrecer entretenimiento en vivo sin la autorización que exija el municipio puede acarrear multas y órdenes de cierre; esta tarjeta se queda en \"se necesita más información\" hasta que se confirmen el tipo, el escenario y los horarios del entretenimiento — y la ordenanza del propio municipio."),
  ]),
  // REG-GUIDE-OPPE-001 (2026-09-18 QA): the OPPE installer registration card
  // rendered the unvalidated-description placeholder on a live Toa Alta
  // solar-installer filing. Conditions cover the BT firing path
  // (RULE_0605, BT_SOLAR_INSTALLER) plus the generic businessType fallback
  // (d4940f4 class).
  DOC_OPPE_INSTALLER_REG: concept("DOC_OPPE_INSTALLER_REG", [
    [condition("businessType", "Solar Installer", "Instalador solar", "BT_SOLAR_INSTALLER")],
    [business],
  ], [PR_GUIDANCE_SOURCES.oppe], [
    text("Puerto Rico's energy public policy (Ley 17-2019) requires installers of renewable electric systems to hold the PPPE/OPPE installer registration — the Certificación de Instalador de Sistemas Eléctricos Renovables. The registration identifies the system types the installer is qualified for — photovoltaic (PV) or wind (AE) — and must be renewed.", "La política pública energética de Puerto Rico (Ley 17-2019) exige que los instaladores de sistemas eléctricos renovables tengan el registro de instalador de OPPE — la Certificación de Instalador de Sistemas Eléctricos Renovables del PPPE. El registro identifica los tipos de sistema para los que el instalador está cualificado — fotovoltaico (PV) o aerogenerador (AE) — y hay que renovarlo."),
    text("The OPPE installer registration is the installer's credential with the energy program: it documents that the installer completed the required installer course (or NABCEP/US course plus the 4-hour PR norms course), holds a professional license as an engineer or electrician, and passed the exam.", "El registro de instalador de OPPE es la credencial del instalador ante el programa de energía: documenta que completó el curso de instalador requerido (o el curso NABCEP/EE. UU. más el curso de 4 horas de normas de PR), que tiene licencia profesional de ingeniero o electricista, y que aprobó el examen."),
    text("Apply for a new OPPE installer registration or renew with the PPPE (Programa de Política Pública Energética, DDEC): complete the official application, attach the course certificate, the exam score (new applications), the professional license, and evidence of collegiation for engineers, and submit by email to energia@ddec.pr.gov or in person at the PPPE offices.", "Solicita el registro de instalador de OPPE nuevo o la renovación en el PPPE (Programa de Política Pública Energética, DDEC): completa la solicitud oficial, adjunta el certificado del curso, la puntuación del examen (solicitudes nuevas), la licencia profesional y la evidencia de colegiación para ingenieros, y envíala por correo electrónico a energia@ddec.pr.gov o entrégala en persona en las oficinas del PPPE."),
    text("Working as a renewable-systems installer without the OPPE installer registration leaves the work outside the energy program's authorization framework; false statements on the application are grounds for cancellation of the certification and fines.", "Trabajar como instalador de sistemas renovables sin el registro de instalador de OPPE deja el trabajo fuera del marco de autorización del programa de energía; la información falsa en la solicitud es motivo de cancelación de la certificación y multas."),
  ]),
  // REG-GUIDE-SIGN-001 (2026-09-20 QA): the Sign / Rótulo Permit card
  // rendered the unvalidated-description placeholder on live Guaynabo
  // (car wash), San Juan (boutique), and Carolina (gym) filings. Conditions
  // cover every firing path: the signage question (RULE_0030, heuristic +
  // missing sign_installation_plans) and the tourism-flag retail rules
  // (RULE_0535/0537/0539/0541/0543), plus the generic businessType fallback
  // (d4940f4 class — the BT is the honest trigger explanation for a
  // rule match with no question path).
  DOC_SIGN_PERMIT: concept("DOC_SIGN_PERMIT", [
    [condition("Q_COMMERCIAL_SIGNAGE", "Commercial signage: Yes", "Rotulación comercial: Sí", true)],
    [business],
  ], [PR_GUIDANCE_SOURCES.signRotulo], [
    text("Exterior commercial signage (rótulos) in Puerto Rico is regulated under the Uniform Sign and Advertisement Law (Ley 355-1999). Before a storefront sign, monument sign, or advertising panel goes up, the business needs the municipality's sign/rótulo authorization (Art. 29, 9 L.P.R.A. § 56b).", "La rotulación comercial exterior (rótulos) en Puerto Rico se rige por la Ley Uniforme de Rótulos y Anuncios (Ley 355-1999). Antes de instalar un rótulo de fachada, un rótulo monumental o un panel publicitario, el negocio necesita la autorización de rótulos del municipio (Art. 29, 9 L.P.R.A. § 56b)."),
    text("The sign authorization covers the specific sign at the specific location — its size, placement, and design must conform to the municipal ordinance that governs signs in that municipality.", "La autorización de rótulos cubre el rótulo específico en la ubicación específica — su tamaño, ubicación y diseño tienen que conformar a la ordenanza municipal que rige los rótulos en ese municipio."),
    // Status-neutral next action (concepts are shared across business
    // statuses): "obtain or confirm", never "apply for" on an existing
    // business (the 590603a lesson).
    text("Obtain the sign authorization from the municipality's permits office — or through the OGPe Permiso Único where the municipality routes signage through it — before fabrication and installation, or confirm an existing sign authorization is current. Provide the sign's design, dimensions, and installation details.", "Obtén la autorización de rótulos en la oficina de permisos del municipio — o por el Permiso Único de OGPe donde el municipio tramite la rotulación por esa vía — antes de fabricar e instalar el rótulo, o confirma que una autorización de rótulos vigente está al día. Provee el diseño, las dimensiones y los detalles de instalación del rótulo."),
    text("Signage installed without the municipal authorization can trigger enforcement action and removal orders; keep the issued authorization with the premises records.", "La rotulación instalada sin la autorización municipal puede acarrear acción de fiscalización y órdenes de remoción; guarda la autorización emitida en los récords del local."),
  ]),
  // REG-GUIDE-ANNUAL-001 (2026-09-20 QA): the Annual Report / Annual Fee
  // card rendered the unvalidated-description placeholder on a live
  // Carolina gym filing. The rule (RULE_0636) is requires_business with
  // excluded entity types, so the generic businessType fallback is the
  // honest condition path; entity-type eligibility is the rule's job, not
  // the concept's.
  DOC_ANNUAL_REPORT: concept("DOC_ANNUAL_REPORT", [
    [business],
  ], [PR_GUIDANCE_SOURCES.annualReport], [
    text("Puerto Rico corporations and LLCs owe the Department of State a yearly filing: corporations file the Informe Anual, and LLCs pay the $150 annual fee with basic company information, on or before April 15 each year (Ley 164-2009, Art. 15.01(A) for corporations; Art. 21.03(C) for LLCs).", "Las corporaciones y las LLC de Puerto Rico le deben una radicación anual al Departamento de Estado: las corporaciones radican el Informe Anual, y las LLC pagan la anualidad de $150 con la información básica de la compañía, en o antes del 15 de abril de cada año (Ley 164-2009, Art. 15.01(A) para corporaciones; Art. 21.03(C) para LLC)."),
    text("The annual report (corporations) and the $150 annual fee (LLCs) keep the entity in good standing with the Department of State: they confirm the resident agent and the company's current information on the public record.", "El informe anual (corporaciones) y la anualidad de $150 (LLC) mantienen la entidad al día (good standing) con el Departamento de Estado: confirman el agente residente y la información vigente de la compañía en el registro público."),
    // Status-neutral: RULE_0636 carries compliance_mode=verify_existing,
    // so the next action reads for existing holders ("verify … current"),
    // which is also correct for a new entity approaching its first filing.
    text("Verify the entity's standing with the Department of State and confirm the April 15 deadline on the current-year calendar; file the Informe Anual (corporations) or pay the annual fee (LLCs) through the Department of State's filing portal at estado.pr.gov.", "Verifica que la entidad esté al día con el Departamento de Estado y confirma la fecha límite del 15 de abril en el calendario del año en curso; radica el Informe Anual (corporaciones) o paga la anualidad (LLC) en el portal de radicaciones del Departamento de Estado (estado.pr.gov)."),
    text("Missing the April 15 deadline can cost a lot: the administrative fine is $750 for a for-profit corporation, and LLCs owe $500 plus 1.5% monthly interest on the $150 annual fee — and an entity that stays delinquent can lose its good standing and have its registration cancelled.", "Perder la fecha límite del 15 de abril puede salir caro: la multa administrativa es de $750 para una corporación con fines de lucro, y las LLC deben $500 más 1.5% de interés mensual sobre la anualidad de $150 — y una entidad que siga en mora puede perder su buen estado (good standing) y el Departamento puede cancelar su registro."),
  ]),
  // REG-GUIDE-OUTDOOR-001 (2026-09-20 QA): the Outdoor Seating Authorization
  // card rendered the unvalidated-description placeholder on a live Mayagüez
  // café filing (S96). The San Juan basis is primary-source verified
  // (Código de Orden Público, Art. 2.301, verbatim 2026-09-20); the concept
  // is self-scoped — San Juan facts cite Art. 2.301, other municipalities are
  // directed to their own municipal ordinance (no invented Mayagüez basis).
  // Conditions cover the seating question (RULE_0031) plus the generic
  // businessType fallback (d4940f4 class).
  DOC_OUTDOOR_SEATING_AUTH: concept("DOC_OUTDOOR_SEATING_AUTH", [
    [condition("Q_OUTDOOR_SEATING", "Outdoor seating: Yes", "Mesas en la acera: Sí", true)],
    [business],
  ], [PR_GUIDANCE_SOURCES.outdoorSeating], [
    text("Tables and chairs on a public sidewalk (acera) or other public space are not covered by the café's use permit alone — occupying public space needs the municipality's separate authorization. In San Juan, Art. 2.301 of the Código de Orden Público requires cafés al aire libre, bars, and other restaurant operations on sidewalks and public spaces to obtain the municipality's authorization.", "Las mesas y sillas en la acera u otro espacio público no están cubiertas por el permiso de uso del café nada más — ocupar el espacio público requiere la autorización separada del municipio. En San Juan, el Art. 2.301 del Código de Orden Público exige que los cafés al aire libre, bares y demás operaciones de restaurantes en aceras y espacios públicos obtengan la autorización del Municipio."),
    text("The authorization permits a specific outdoor seating arrangement — the number of tables, the footprint, and the exact location on the public space — under the municipality's conditions: clear passage for pedestrians, operating hours, and compliance with sanitary and health laws and regulations. It does not replace the café's health and sanitary permits.", "La autorización permite un arreglo específico de mesas en el exterior — la cantidad de mesas, el área que ocupan y la ubicación exacta en el espacio público — bajo las condiciones del municipio: paso libre para los peatones, horario de operación y cumplimiento con las leyes y reglamentos de sanidad y salud. No sustituye los permisos sanitarios del café."),
    text("Request the authorization from the municipality's permits office before placing tables and chairs on the sidewalk or public space — in San Juan under Art. 2.301 of the Código de Orden Público; in other municipalities, confirm the applicable municipal ordinance with the alcaldía first. Have the seating layout ready: number of tables and chairs, dimensions, and the exact spot on the acera.", "Solicita la autorización en la oficina de permisos del municipio antes de poner mesas y sillas en la acera o el espacio público — en San Juan bajo el Art. 2.301 del Código de Orden Público; en otros municipios, confirma primero en la alcaldía la ordenanza municipal que aplica. Ten a la mano el plano del arreglo: cantidad de mesas y sillas, dimensiones y el punto exacto en la acera."),
    text("Outdoor seating on public space without the municipal authorization exposes the business to fines and sanctions under the applicable municipal ordinance; operating out of compliance can also complicate the café's other permits.", "Poner mesas en el espacio público sin la autorización municipal expone el negocio a multas y sanciones bajo la ordenanza municipal que aplique; operar fuera de cumplimiento también puede enredar los demás permisos del café."),
  ]),
  // REG-GUIDE-TAX-COMPLIANCE-001 (2026-09-21 QA): the Hacienda Tax Filing &
  // Debt Compliance Evidence card rendered the unvalidated-description
  // placeholder on live Carolina and Ponce alcohol-chain filings (S98/S99,
  // 2026-09-21 00:00). The requirement is grounded in Hacienda's official
  // internal-revenue license requirements: tax filing/debt compliance is one
  // of the official prerequisites for the beverage-alcohol internal-revenue
  // licenses — founder judgment §29.2 (2026-09-16, settled) for the retail
  // dealer license, and Hacienda's official requirements page lists it for
  // every license type including the manufacturer/fabricante license
  // (verified 2026-09-21 from hacienda.pr.gov).
  // Conditions cover the Q_ALCOHOL_SOLD firing path (RULE_0663, verified)
  // plus the generic businessType fallback (d4940f4 class); the next action
  // is status-neutral ("obtain or confirm") because RULE_0663 carries
  // compliance_mode=verify_existing (the 590603a lesson).
  DOC_HACIENDA_TAX_COMPLIANCE: concept("DOC_HACIENDA_TAX_COMPLIANCE", [
    [condition("Q_ALCOHOL_SOLD", "Alcohol sales: Yes", "Venta de alcohol: Sí", true)],
    [business],
  ], [PR_GUIDANCE_SOURCES.taxCompliance], [
    text("Hacienda requires alcohol-license applicants to prove they are current on tax filings and free of tax debts. The tax filing and debt compliance evidence is one of Hacienda's official prerequisites for beverage-alcohol internal-revenue licenses (licencias de rentas internas de bebidas alcohólicas — the retail dealer, wholesale, and manufacturer licenses) — Hacienda does not issue the license to a business with unfiled returns or outstanding tax debts.", "Hacienda exige que quien solicita una licencia de bebidas alcohólicas pruebe que está al día en la radicación de planillas y libre de deudas contributivas. Esta evidencia de radicación y cumplimiento contributivo es uno de los requisitos oficiales para las licencias de rentas internas de bebidas alcohólicas de Hacienda — la de detallista, la de por mayor y la de fabricante — Hacienda no emite la licencia a un negocio con planillas sin radicar o deudas contributivas pendientes."),
    text("This evidence proves the business is in good tax standing with Hacienda: the required returns are filed and there is no outstanding tax debt. It belongs in the alcohol-license file alongside the Merchant Registration, the ASUME certification, the municipal patent, the CRIM debt certification, and the criminal-record certificate.", "Esta evidencia demuestra que el negocio está al día con Hacienda: las planillas requeridas están radicadas y no hay deudas contributivas por pagar. Es parte del expediente de la licencia de bebidas alcohólicas, junto al Registro de Comerciante, la certificación de ASUME, la patente municipal, la certificación de deuda de CRIM y el certificado de antecedentes penales."),
    // Status-neutral next action (concepts are shared across business
    // statuses): "obtain or confirm", never "apply for" on an existing
    // business (the 590603a lesson).
    text("Obtain the tax filing and debt compliance evidence through Hacienda's SURI portal — the filing certification (Certificación de Radicación de Planillas) and the debt-free certification — or confirm the evidence already in the file is current. File any missing returns and pay any outstanding debts first so the certifications come back clean.", "Obtén la evidencia de radicación y cumplimiento contributivo por el portal SURI de Hacienda — la Certificación de Radicación de Planillas y la certificación de libre de deuda — o confirma que la evidencia que ya está en el expediente sigue vigente. Radica primero cualquier planilla pendiente y salda cualquier deuda contributiva para que las certificaciones salgan limpias."),
    text("An alcohol-license application filed without this evidence is incomplete: Hacienda holds the license until the tax filing and debt compliance evidence enters the file. Resolve filing gaps and debts early — they are the most common cause of license delays.", "Una solicitud de licencia de bebidas alcohólicas sin esta evidencia está incompleta: Hacienda la detiene hasta que la evidencia de radicación y cumplimiento contributivo entre al expediente. Brega con las planillas y deudas contributivas temprano — son la causa más común de atrasos en la licencia."),
  ]),
  // REG-GUIDE-ALCOHOL-SALES-001 (2026-09-21 QA): the Alcohol Sales
  // Projection / Volume Information card rendered the unvalidated-description
  // placeholder on live alcohol-chain filings. The requirement is grounded in
  // Hacienda's official internal-revenue license requirements: projected
  // sales is one of the official prerequisites for the beverage-alcohol
  // internal-revenue licenses — founder judgment §29.2 (2026-09-16, settled)
  // for the retail dealer license, and Hacienda's official requirements page
  // lists it for every license type including the manufacturer/fabricante
  // license (verified 2026-09-21 from hacienda.pr.gov). RULE_0665 is heuristic with
  // missing_fact_keys=[alcohol_sales_volume], so the copy stays honest
  // about the unresolved volume fact — no invented volume thresholds.
  // Conditions cover the Q_ALCOHOL_SOLD firing path (RULE_0665) plus the
  // generic businessType fallback (d4940f4 class).
  DOC_ALCOHOL_SALES_PROJECTION: concept("DOC_ALCOHOL_SALES_PROJECTION", [
    [condition("Q_ALCOHOL_SOLD", "Alcohol sales: Yes", "Venta de alcohol: Sí", true)],
    [business],
  ], [PR_GUIDANCE_SOURCES.alcoholSales], [
    text("Hacienda asks alcohol-license applicants for their projected alcohol sales volume. The alcohol sales projection is one of Hacienda's official prerequisites for beverage-alcohol internal-revenue licenses (licencias de rentas internas de bebidas alcohólicas — retail dealer, wholesale, and manufacturer) — it tells the agency the scale of the operation the license will cover.", "Hacienda pide a los solicitantes de la licencia de bebidas alcohólicas una proyección del volumen de ventas de alcohol. La proyección de ventas es uno de los requisitos oficiales para las licencias de rentas internas de bebidas alcohólicas — detallista, por mayor y fabricante — le dice a la agencia la escala de la operación que cubrirá la licencia."),
    text("This sales projection describes the volume of alcohol the business expects to sell — how much, and of what type — so Hacienda can complete the license file. It is a filing input for the alcohol license, alongside the Merchant Registration, the ASUME and CRIM certifications, and the criminal-record certificate.", "Esta proyección describe el volumen de alcohol que el negocio espera vender — cuánto y de qué tipo — para completar el expediente de la licencia. Es un insumo de la solicitud de la licencia de bebidas alcohólicas, junto al Registro de Comerciante, las certificaciones de ASUME y CRIM, y el certificado de antecedentes penales."),
    text("Prepare the projected sales volume for the licensed premises — estimated monthly or annual alcohol sales — and enter it when completing the alcohol-license application. Keep the working numbers with the license file; Hacienda uses them as the declared basis for the license.", "Prepara la proyección del volumen de ventas del local — ventas de alcohol estimadas por mes o por año — y anótala al completar la solicitud de la licencia. Guarda los números de trabajo en el expediente; Hacienda los usa como la base declarada de la licencia."),
    text("An alcohol-license application without the sales projection is incomplete: Hacienda holds the license until the projected sales volume is in the file. Prepare the numbers before filing so the application is not held up.", "Una solicitud de licencia de bebidas alcohólicas sin la proyección de ventas está incompleta: Hacienda la detiene hasta que el volumen proyectado entre al expediente. Prepara los números antes de radicar para que la solicitud no se tranque."),
  ]),
  // REG-TOBACCO-RETAIL-001 (2026-09-28 QA): the tobacco sales projection is
  // one of Hacienda's official prerequisites for the Licencia de
  // Detallista / Mayorista de Cigarrillos ("Proyección o Volumen de Ventas",
  // verified 2026-09-28) — mirrors the alcohol sales-projection card.
  DOC_TOBACCO_SALES_PROJECTION: concept("DOC_TOBACCO_SALES_PROJECTION", [
    [condition("Q_TOBACCO_SOLD", "Tobacco sales: Yes", "Venta de productos de tabaco: Sí", true)],
    [business],
  ], [PR_GUIDANCE_SOURCES.tobaccoReqs], [
    text("Hacienda wants to know the scale of your tobacco business before it licenses you. On its official list of prerequisites for the cigarette dealer license, Hacienda names the sales projection ('Proyecci\u00f3n o Volumen de Ventas') \u2014 your estimate of how much tobacco you will move. The estimate goes into the license file along with the ASUME and CRIM clearances, the criminal-record certificate, and the Merchant Registration.", "Hacienda quiere conocer la escala de tu negocio de tabaco antes de licenciarlo. En su lista oficial de requisitos para la licencia de detallista de cigarrillos, Hacienda incluye la proyecci\u00f3n de ventas ('Proyecci\u00f3n o Volumen de Ventas') \u2014 tu estimado de cu\u00e1nto tabaco vender\u00e1s. El estimado entra al expediente de la licencia junto con las certificaciones de ASUME y CRIM, el certificado de antecedentes penales y el Registro de Comerciante."),
    text("The projection tells Hacienda what size of tobacco operation it is authorizing. A corner store selling a few packs a week and a larger smoke shop get judged on different numbers, and the license file needs your number in it before Hacienda signs off.", "La proyecci\u00f3n le dice a Hacienda qu\u00e9 tama\u00f1o de operaci\u00f3n de tabaco est\u00e1 autorizando. Un colmado que vende unas cajetillas a la semana y una tabaquer\u00eda m\u00e1s grande se eval\u00faan con n\u00fameros distintos, y el expediente necesita tu n\u00famero antes de que Hacienda firme."),
    text("Put a monthly or annual tobacco-sales estimate in writing \u2014 packs, cartons, units \u2014 and bring it when you file the cigarette-dealer license application in SURI. Keep a copy with the license file; it is the declared sales basis of your application.", "Pon por escrito un estimado mensual o anual de ventas de tabaco \u2014 cajetillas, cartones, unidades \u2014 y ll\u00e9valo cuando radiques la solicitud de licencia de detallista de cigarrillos en SURI. Guarda copia en el expediente; es la base declarada de ventas de tu solicitud."),
    text("No projection, no license. Hacienda will not issue the cigarette dealer license until the projected sales figure is in the file. Write the estimate up front so the filing does not sit waiting for it.", "Sin proyecci\u00f3n no hay licencia. Hacienda no expide la licencia de detallista de cigarrillos hasta que la cifra de ventas proyectadas est\u00e9 en el expediente. Prepara el estimado por adelantado para que la solicitud no se quede esperando."),
  ]),
  // REG-GUIDE-FDA-001 (2026-09-21 QA): the FDA Food Facility Registration
  // card rendered the unvalidated-description placeholder with a confident
  // REQUIRED badge on live Arecibo brewery and Trujillo Alto roastery
  // filings (S100/S102). The concept is grounded in FD&C Act §415
  // (21 U.S.C. §350d) and 21 CFR Part 1, Subpart H (verified 2026-09-21 from
  // fda.gov): domestic facilities — including Puerto Rico — that
  // manufacture, process, pack, or hold food for US consumption must
  // register; biennial renewal Oct 1–Dec 31 of even-numbered years.
  // Status-neutral ("register or confirm"); no invented UFI mechanics beyond
  // what FDA's own renewal guide states.
  DOC_FDA_FOOD_FACILITY_REGISTRATION: concept("DOC_FDA_FOOD_FACILITY_REGISTRATION", [
    [condition("businessType", "Beverage manufacturing", "Manufactura de bebidas", "BT_BEVERAGE_MANUFACTURING")],
    [condition("businessType", "Food manufacturing", "Manufactura de alimentos", "BT_FOOD_MANUFACTURING")],
    [business],
  ], [PR_GUIDANCE_SOURCES.fda], [
    text("The FDA requires domestic food facilities — including facilities in Puerto Rico — that manufacture, process, pack, or hold food for consumption in the United States to register with the agency. A food or beverage plant — for example a sauce, bakery-goods or snack manufacturer, a brewery or a bottler — is a food facility under Section 415 of the Federal Food, Drug, and Cosmetic Act (21 U.S.C. §350d); 21 CFR Part 1, Subpart H sets the registration rules.", "La FDA exige que las instalaciones alimentarias domésticas — incluyendo las de Puerto Rico — que manufacturan, procesan, empacan o almacenan alimentos para consumo en los Estados Unidos se registren con la agencia. Una planta de alimentos o bebidas — por ejemplo un fabricante de salsas, panadería industrial o meriendas, una cervecería o una embotelladora — es una instalación alimentaria bajo la Sección 415 de la ley federal de alimentos, medicamentos y cosméticos (21 U.S.C. §350d); el 21 CFR Parte 1, Subparte H establece las reglas de registro."),
    text("The registration puts the facility on FDA's official record as a food facility — it is how the agency knows who makes food and where. It is not a license to sell and does not replace Puerto Rico's health and sanitary permits.", "El registro pone la instalación en el récord oficial de la FDA como instalación alimentaria — es como la agencia sabe quién produce alimentos y dónde. No es una licencia de venta ni sustituye los permisos sanitarios de Puerto Rico."),
    text("Register the facility through FDA's online Food Facility Registration system (free), or confirm the existing registration is current — registrations renew every two years, October 1 through December 31 of even-numbered years, and must be updated when facility information changes.", "Registra la instalación en el sistema en línea de registro de instalaciones alimentarias de la FDA (gratis), o confirma que el registro existente sigue vigente — los registros se renuevan cada dos años, del 1 de octubre al 31 de diciembre de los años pares, y hay que actualizarlos cuando cambia la información de la instalación."),
    text("An unregistered food facility violates federal law — FDA can enforce the registration requirement against the operation. Keep the registration number in the facility's compliance file and calendar the biennial renewal.", "Una instalación alimentaria sin registrar viola la ley federal — la FDA puede hacer valer el requisito de registro contra la operación. Guarda el número de registro en el expediente de cumplimiento y apunta la renovación bienal en el calendario."),
  ]),
  // REG-GUIDE-WASTEWATER-001 (2026-09-21 QA): the Wastewater Discharge /
  // Sewer Pretreatment Authorization card rendered the unvalidated
  // placeholder on the same live beverage-manufacturing filings
  // (RULE_0668/0669, municipality_flag heuristic, MORE INFORMATION NEEDED).
  // Concept stays general — AAA discharge/pretreatment authorization for
  // industrial wastewater to the public sewer, DRNA water-quality oversight —
  // status-neutral ("confirm or document"), no invented thresholds/forms.
  // REG-GUIDE-WASTEWATER-CARWASH-001 (2026-10-02 QA): the concept fires for
  // both beverage manufacturing AND car washes (RULE_0666, coastal flag),
  // but the regulatoryReason was written only for breweries — a live
  // Mayagüez car wash (S365) rendered "Beverage manufacturing produces
  // industrial wastewater — from brewing, cleaning, and cooling…" as its
  // own situation. The lead text is now industry-neutral, naming both
  // covered industries explicitly.
  DOC_WASTEWATER_DISCHARGE_AUTHORIZATION: concept("DOC_WASTEWATER_DISCHARGE_AUTHORIZATION", [
    [condition("businessType", "Beverage manufacturing", "Manufactura de bebidas", "BT_BEVERAGE_MANUFACTURING")],
    [condition("businessType", "Car wash", "Car wash", "BT_CAR_WASH")],
    [business],
  ], [PR_GUIDANCE_SOURCES.wastewater], [
    text("Some businesses produce industrial wastewater that cannot go down the drain untreated: beverage plants generate it from brewing, cleaning, and cooling, and car washes from wash water carrying detergents, oils, and grease. When a facility discharges that wastewater to the public sewer, the Autoridad de Acueductos y Alcantarillados (AAA) requires a discharge/pretreatment authorization; DRNA oversees water-quality protection island-wide.", "Algunos negocios generan aguas residuales industriales que no pueden ir al drenaje sin tratar: las plantas de bebidas las producen del proceso, la limpieza y el enfriamiento, y los car wash del agua de lavado con detergentes, aceites y grasa. Cuando una instalación descarga esas aguas al alcantarillado público, la Autoridad de Acueductos y Alcantarillados (AAA) requiere una autorización de descarga/pretratamiento; el DRNA supervisa la protección de la calidad del agua en toda la isla."),
    text("The authorization sets the terms under which the facility may discharge industrial wastewater to the sewer — what pretreatment is required and what limits apply. It is separate from the municipal use permit and the health permit.", "La autorización establece las condiciones bajo las cuales la instalación puede descargar aguas residuales industriales al alcantarillado — qué pretratamiento se requiere y qué límites aplican. Es aparte del permiso de uso municipal y del permiso de salud."),
    text("Confirm with AAA whether the facility's wastewater discharge needs a pretreatment authorization — have the discharge route ready (to the public sewer, to a private system, or hauled off-site). If the operation produces no industrial wastewater discharge, document that so the file is clear.", "Confirma con la AAA si la descarga de aguas residuales de la instalación requiere una autorización de pretratamiento — ten a la mano la ruta de descarga (al alcantarillado público, a un sistema privado o por acarreo). Si la operación no genera descarga de aguas industriales, documéntalo para que el expediente quede claro."),
    text("Discharging industrial wastewater to the sewer without the required authorization exposes the facility to AAA enforcement and DRNA sanctions. Resolve the discharge route before the facility starts operating.", "Descargar aguas industriales al alcantarillado sin la autorización requerida expone la instalación a acciones de la AAA y sanciones del DRNA. Resuelve la ruta de descarga antes de que la instalación empiece a operar."),
  ]),
  // REG-GUIDE-STORMWATER-001 (2026-09-21 QA): the NPDES
  // Industrial-Stormwater Coverage / No-Exposure Determination card rendered
  // the unvalidated placeholder on the same live filings (RULE_0670/0671,
  // municipality_flag heuristic, MORE INFORMATION NEEDED). Concept stays at
  // the program level — NPDES coverage or certified no-exposure exclusion
  // via EPA/DRNA — status-neutral, no invented sector codes or deadlines.
  DOC_NPDES_INDUSTRIAL_STORMWATER: concept("DOC_NPDES_INDUSTRIAL_STORMWATER", [
    [condition("businessType", "Beverage manufacturing", "Manufactura de bebidas", "BT_BEVERAGE_MANUFACTURING")],
    [condition("businessType", "Food manufacturing", "Manufactura de alimentos", "BT_FOOD_MANUFACTURING")],
    [condition("businessType", "Tire recycling", "Reciclaje de gomas", "BT_TIRE_RECYCLING")],
    [business],
  ], [PR_GUIDANCE_SOURCES.stormwaterIndustrial], [
    text("Industrial sites whose operations are exposed to rain — outdoor storage, loading areas, waste handling — need federal stormwater coverage. Under the NPDES industrial stormwater program, the facility needs permit coverage or a certified no-exposure exclusion; in Puerto Rico this runs through the EPA/DRNA program.", "Las instalaciones industriales cuyas operaciones están expuestas a la lluvia — almacenaje al aire libre, áreas de carga, manejo de desperdicios — necesitan cobertura federal de aguas pluviales. Bajo el programa NPDES de aguas pluviales industriales, la instalación necesita cobertura del permiso o una exclusión certificada de no exposición; en Puerto Rico esto corre por el programa EPA/DRNA."),
    text("The coverage — or the no-exposure certification — documents how stormwater leaving the site is controlled, or certifies that no industrial materials are exposed to rain at all. It is separate from the wastewater discharge authorization.", "La cobertura — o la certificación de no exposición — documenta cómo se controlan las aguas pluviales que salen del predio, o certifica que ningún material industrial está expuesto a la lluvia. Es aparte de la autorización de descarga de aguas residuales."),
    text("Confirm with EPA/DRNA whether the site needs industrial stormwater permit coverage or qualifies for the no-exposure exclusion — walk the site for exposed materials, outdoor storage, and loading areas first. File the coverage or the no-exposure certification before operations expose materials to rain.", "Confirma con EPA/DRNA si el predio necesita cobertura del permiso de aguas pluviales industriales o si cualifica para la exclusión de no exposición — primero recorre el predio buscando materiales expuestos, almacenaje al aire libre y áreas de carga. Radica la cobertura o la certificación de no exposición antes de que las operaciones expongan materiales a la lluvia."),
    text("Operating an exposed industrial site without stormwater coverage is a federal Clean Water Act violation. Keep the coverage or no-exposure certification in the facility's environmental file.", "Operar un predio industrial expuesto sin cobertura de aguas pluviales es una violación federal de la Ley de Agua Limpia. Guarda la cobertura o la certificación de no exposición en el expediente ambiental de la instalación."),
  ]),
  // REG-GUIDE-AIR-001 (2026-09-21 QA): the Air Permit / Minor-Source
  // Determination card rendered the unvalidated placeholder on the same
  // live filings (RULE_0674/0675, municipality_flag heuristic, MORE
  // INFORMATION NEEDED). Concept stays at the program level — DRNA
  // administers Puerto Rico's own air-emissions program (not federal EPA
  // Title V) — status-neutral, no invented emission thresholds.
  DOC_AIR_PERMIT: concept("DOC_AIR_PERMIT", [
    [condition("businessType", "Beverage manufacturing", "Manufactura de bebidas", "BT_BEVERAGE_MANUFACTURING")],
    [condition("businessType", "Auto body shop", "Taller de hojalatería y pintura", "BT_BODY_SHOP")],
    [condition("businessType", "Tire recycling", "Reciclaje de gomas", "BT_TIRE_RECYCLING")],
    [business],
  ], [PR_GUIDANCE_SOURCES.airPermit], [
    text("Some operations release air pollutants — boilers and fuel-burning equipment at manufacturing plants, process vapors, and paint and solvent emissions from spray booths. Puerto Rico runs its own air quality program through the Departamento de Recursos Naturales y Ambientales (DRNA); a facility with air emissions may need a DRNA air permit or a minor-source determination.", "Algunas operaciones liberan contaminantes al aire — calderas y equipo que quema combustible en plantas de manufactura, vapores de proceso, y emisiones de pintura y solventes en cabinas de pintura. Puerto Rico corre su propio programa de calidad del aire a través del Departamento de Recursos Naturales y Ambientales (DRNA); una instalación con emisiones puede necesitar un permiso de aire del DRNA o una determinación de fuente menor."),
    text("The air permit — or the minor-source determination — establishes which emissions the facility may release and under what controls. It is separate from the municipal use permit and from any federal EPA filing: Puerto Rico's program runs through DRNA.", "El permiso de aire — o la determinación de fuente menor — establece qué emisiones puede liberar la instalación y bajo qué controles. Es aparte del permiso de uso municipal y de cualquier radicación federal ante la EPA: el programa de Puerto Rico corre por el DRNA."),
    text("Confirm with DRNA whether the facility's equipment and emissions trigger an air permit or a minor-source determination — have the equipment list ready (boilers, burners, fuel types, spray booths, and paint and solvent use). If the operation has no meaningful air emissions, document that so the file is clear.", "Confirma con el DRNA si el equipo y las emisiones de la instalación activan un permiso de aire o una determinación de fuente menor — ten a la mano la lista de equipos (calderas, quemadores, tipos de combustible, cabinas de pintura y uso de pinturas y solventes). Si la operación no tiene emisiones significativas, documéntalo para que el expediente quede claro."),
    text("Operating emission sources without the required DRNA air permit exposes the facility to DRNA enforcement. Resolve the air question before installing fuel-burning equipment or a spray booth.", "Operar fuentes de emisión sin el permiso de aire requerido del DRNA expone la instalación a acciones del DRNA. Resuelve lo del aire antes de instalar equipo que queme combustible o una cabina de pintura."),
  ]),
  // REG-KB-GAPS-001 (2026-10-04, KG scenario suite): validated concepts for
  // the documents added to close the knowledge-graph gaps (historic zones,
  // regulatory floodway, controlled substances, medical cannabis, telecom
  // towers, marine/watercraft, recycling, auto-body coating). Each concept
  // cites the primary source the KB rule cites; conditional and heuristic
  // rules still render as provisional (applicability not confirmed).
  DOC_ICP_HISTORIC_RECOMMENDATION: concept("DOC_ICP_HISTORIC_RECOMMENDATION", [
    [condition("project_type", "Construction or renovation project", "Proyecto de construcción o remodelación")],
    [business],
  ], [KB_GAP_SOURCES.icp, KB_GAP_SOURCES.rcHistoric], [
    text("Puerto Rico's historic-zones law (Ley 374-1949, Art. 1) bars OGPe and the autonomous municipalities from issuing a construction or use permit inside a historic zone until the Instituto de Cultura Puertorriqueña (ICP) gives its written recommendation. The Reglamento Conjunto extends the same ICP review to buildings on the National Register, sites on the Junta de Planificación's historic registry, and the plazas and surrounding blocks of town founding centers.", "La ley de zonas históricas de Puerto Rico (Ley 374-1949, Art. 1) impide que OGPe y los municipios autónomos expidan un permiso de construcción o de uso dentro de una zona histórica sin la recomendación escrita del Instituto de Cultura Puertorriqueña (ICP). El Reglamento Conjunto extiende esa misma revisión del ICP a los edificios del Registro Nacional, los sitios del registro histórico de la Junta de Planificación y las plazas y cuadras circundantes de los centros fundacionales."),
    text("The ICP recommendation confirms that the project's architecture, materials, colors, signs and proposed use fit the character of the historic zone. It is a prerequisite inside the permit file, not a separate permit, and it covers only the work and use described in the application.", "La recomendación del ICP confirma que la arquitectura, los materiales, los colores, los rótulos y el uso propuesto del proyecto armonizan con el carácter de la zona histórica. Es un requisito previo dentro del expediente del permiso, no un permiso aparte, y cubre solo la obra y el uso descritos en la solicitud."),
    text("Before designing exterior work, review the ICP's historic-zone guidelines; then file the request through the Single Business Portal with the permit application, with photographs of the existing building and drawings of the proposed facade, signs and finishes. Signs, awnings, exterior paint, demolition and alcohol sales in a historic zone each need their own ICP recommendation.", "Antes de diseñar la obra exterior, revisa las guías del ICP para zonas históricas; luego radica la solicitud por el Single Business Portal junto con la del permiso, con fotos del edificio existente y planos de la fachada, los rótulos y las terminaciones propuestas. Los rótulos, toldos, pintura exterior, demoliciones y la venta de alcohol en una zona histórica requieren cada uno su propia recomendación del ICP."),
    text("Without the ICP's written recommendation the permit cannot be issued, and work done in a historic zone without it can be stopped and ordered restored. A favorable recommendation may carry conditions that the construction drawings must follow.", "Sin la recomendación escrita del ICP el permiso no se puede expedir, y la obra hecha en una zona histórica sin ella puede ser paralizada y se puede ordenar su restauración. Una recomendación favorable puede traer condiciones que los planos de construcción deben seguir."),
  ]),
  DOC_SHPO_SECTION106_REVIEW: concept("DOC_SHPO_SECTION106_REVIEW", [
    [condition("project_type", "Construction or renovation project", "Proyecto de construcción o remodelación")],
    [business],
  ], [KB_GAP_SOURCES.section106], [
    text("When a project in or next to a historic property uses federal money, needs a federal permit or holds a federal license, Section 106 of the National Historic Preservation Act requires the federal agency to consult the State Historic Preservation Office (Oficina Estatal de Conservación Histórica) before it approves the project (36 CFR Part 800).", "Cuando un proyecto en o junto a una propiedad histórica usa fondos federales, necesita un permiso federal o tiene una licencia federal, la Sección 106 de la Ley Nacional de Conservación Histórica obliga a la agencia federal a consultar a la Oficina Estatal de Conservación Histórica antes de aprobarlo (36 CFR Parte 800)."),
    text("The Section 106 consultation identifies historic properties the project could affect and settles how to avoid, minimize or mitigate the effects. It runs alongside the ICP's local recommendation and does not replace it.", "La consulta de la Sección 106 identifica las propiedades históricas que el proyecto podría afectar y acuerda cómo evitar, reducir o mitigar los efectos. Corre en paralelo a la recomendación local del ICP y no la sustituye."),
    text("Confirm whether any part of the project is federally funded, permitted or licensed (for example FEMA or HUD recovery funds, an SBA loan, or a Corps of Engineers permit). If so, ask that federal agency to start the Section 106 consultation early and give it the property's history, photographs and the scope of work.", "Confirma si alguna parte del proyecto tiene fondos, permisos o licencias federales (por ejemplo fondos de recuperación de FEMA o HUD, un préstamo de la SBA o un permiso del Cuerpo de Ingenieros). Si es así, pide a esa agencia federal que inicie temprano la consulta de la Sección 106 y entrégale la historia de la propiedad, fotos y el alcance de la obra."),
    text("The federal agency cannot release its funds or approval until the Section 106 review closes; skipping it can cost the federal funding. If the project has no federal involvement, this review does not apply.", "La agencia federal no puede liberar sus fondos ni su aprobación hasta que cierre la revisión de la Sección 106; omitirla puede costar el financiamiento federal. Si el proyecto no tiene participación federal, esta revisión no aplica."),
  ]),
  DOC_FLOODWAY_NO_RISE_CERTIFICATION: concept("DOC_FLOODWAY_NO_RISE_CERTIFICATION", [
    [condition("project_type", "Construction or renovation project", "Proyecto de construcción o remodelación")],
  ], [KB_GAP_SOURCES.reg13Floodway, KB_GAP_SOURCES.nfipFloodway], [
    text("The site is in the regulatory floodway (cauce mayor), the channel that must stay open to carry the base flood. Planning Regulation 13, Sec. 6.01, and the federal flood-insurance rules (44 CFR 60.3(d)(3)) prohibit fill, new construction and other encroachments in the floodway unless an engineering study proves the work causes no rise in flood levels.", "El predio está en el cauce mayor, el canal que debe quedar libre para conducir la inundación base. El Reglamento de Planificación 13, Sec. 6.01, y las normas federales del seguro de inundación (44 CFR 60.3(d)(3)) prohíben rellenos, construcción nueva y otras invasiones del cauce mayor salvo que un estudio de ingeniería demuestre que la obra no causa aumento en los niveles de inundación."),
    text("The no-rise certification is a licensed engineer's hydrologic-hydraulic study, prepared under the Junta de Planificación's guidelines and evaluated by DRNA, showing the project does not raise the base flood elevation. It is a separate engineered deliverable that supports the flood-zone review; the general flood review alone does not authorize work in the floodway.", "La certificación sin aumento (no-rise) es un estudio hidrológico-hidráulico de un ingeniero licenciado, preparado según las guías de la Junta de Planificación y evaluado por el DRNA, que demuestra que el proyecto no eleva el nivel de la inundación base. Es un entregable de ingeniería aparte que sustenta la revisión de zona inundable; la revisión general por sí sola no autoriza obras en el cauce mayor."),
    text("Before design is final, have a licensed engineer evaluate alternatives outside the floodway and, if the work must stay, model it in a hydrologic-hydraulic study. The engineer signs the Junta de Planificación's No-Rise Certificate, which is filed with the flood-zone review and the construction permit.", "Antes de cerrar el diseño, pide a un ingeniero licenciado que evalúe alternativas fuera del cauce mayor y, si la obra tiene que quedarse, que la modele en un estudio hidrológico-hidráulico. El ingeniero firma el Certificado de No Aumento (No-Rise) de la Junta de Planificación, que se radica con la revisión de zona inundable y el permiso de construcción."),
    text("If the study shows any rise, the floodway work cannot be permitted as designed; it must be redesigned or moved. An approved no-rise certification becomes part of the permit record and is checked again at inspection.", "Si el estudio muestra cualquier aumento, la obra en el cauce mayor no se puede permitir tal como está diseñada; hay que rediseñarla o moverla. Una certificación sin aumento aprobada pasa a formar parte del expediente del permiso y se verifica de nuevo en la inspección."),
  ]),
  DOC_PR_CONTROLLED_SUBSTANCES_REGISTRATION: concept("DOC_PR_CONTROLLED_SUBSTANCES_REGISTRATION", [
    [business],
  ], [KB_GAP_SOURCES.prControlled], [
    text("Puerto Rico's Controlled Substances Act (Ley 4-1971, Arts. 302–304) requires every person or establishment that manufactures, distributes, dispenses or stores controlled substances to hold a registration from the Secretario de Salud. The Departamento de Salud issues it through its Controlled Substances Division.", "La Ley de Sustancias Controladas de Puerto Rico (Ley 4-1971, Arts. 302–304) exige que toda persona o establecimiento que fabrique, distribuya, despache o almacene sustancias controladas tenga un registro del Secretario de Salud. El Departamento de Salud lo expide a través de su División de Sustancias Controladas."),
    text("The Puerto Rico controlled-substances registration authorizes the establishment to handle the drug schedules listed on the certificate at that address. It is separate from the pharmacy license and from the federal DEA registration, which the DEA issues only after this one is in place.", "El registro de sustancias controladas de Puerto Rico autoriza al establecimiento a manejar las clasificaciones de drogas indicadas en el certificado en esa dirección. Es aparte de la licencia de farmacia y del registro federal de la DEA, que la DEA expide solo cuando este ya existe."),
    text("File the Departamento de Salud's controlled-substances registration application for the establishment, with the pharmacist-in-charge information and the registration fee, or confirm an existing registration is current. Post the certificate and calendar its renewal.", "Radica ante el Departamento de Salud la solicitud de registro de sustancias controladas del establecimiento, con la información del farmacéutico regente y el pago de los derechos, o confirma que el registro existente está vigente. Exhibe el certificado y apunta su renovación."),
    text("Handling controlled substances without a current Puerto Rico registration is a criminal offense under Ley 4-1971, and the DEA will not register the location without it. Keep inventories and records the registration requires.", "Manejar sustancias controladas sin un registro vigente de Puerto Rico es delito bajo la Ley 4-1971, y la DEA no registra la ubicación sin él. Mantén los inventarios y registros que exige el registro de sustancias controladas."),
  ]),
  DOC_DEA_REGISTRATION: concept("DOC_DEA_REGISTRATION", [
    [business],
  ], [KB_GAP_SOURCES.dea], [
    text("Federal law (21 U.S.C. § 822; 21 CFR 1301.11) requires every person who dispenses controlled substances to register with the U.S. Drug Enforcement Administration (DEA) for each separate location. Pharmacies and practitioners register on DEA Form 224.", "La ley federal (21 U.S.C. § 822; 21 CFR 1301.11) exige que toda persona que despache sustancias controladas se registre con la Administración de Control de Drogas (DEA) de EE. UU. para cada ubicación. Las farmacias y los profesionales se registran con el Formulario 224 de la DEA."),
    text("The DEA registration number authorizes the location to order, store and dispense the federal drug schedules it lists. The DEA issues it only to a location already registered under Puerto Rico's controlled-substances law.", "El número de registro de la DEA autoriza a la ubicación a ordenar, almacenar y despachar las clasificaciones federales que indica. La DEA lo expide solo a una ubicación ya registrada bajo la ley de sustancias controladas de Puerto Rico."),
    text("After the Puerto Rico registration is issued, apply online with the DEA Diversion Control Division on Form 224 for this address, or confirm the existing DEA registration covers it. Calendar the three-year renewal.", "Después de obtener el registro de Puerto Rico, solicita en línea a la División de Control de Desvíos de la DEA con el Formulario 224 para esta dirección, o confirma que el registro existente de la DEA la cubre. Apunta la renovación cada tres años."),
    text("Wholesalers will not ship controlled substances to a location without an active DEA registration, and dispensing without one violates federal law. Keep DEA order forms, inventories and records at the registered location.", "Los mayoristas no envían sustancias controladas a una ubicación sin registro activo de la DEA, y despachar sin él viola la ley federal. Guarda los formularios de órdenes, inventarios y récords de la DEA en la ubicación registrada."),
  ], ["DOC_PR_CONTROLLED_SUBSTANCES_REGISTRATION"]),
  DOC_CANNABIS_DISPENSARY_LICENSE: concept("DOC_CANNABIS_DISPENSARY_LICENSE", [
    [condition("businessType", "Medical cannabis dispensary", "Dispensario de cannabis medicinal", "BT_MEDICAL_CANNABIS_DISPENSARY")],
  ], [KB_GAP_SOURCES.cannabis], [
    text("Puerto Rico's medical cannabis law (Ley 42-2017) makes the Junta Reglamentadora del Cannabis Medicinal, attached to the Departamento de Salud, the licensing authority for every medical cannabis establishment. Only a dispensary licensed by the Junta may sell or dispense medical cannabis to registered patients.", "La ley de cannabis medicinal de Puerto Rico (Ley 42-2017) hace a la Junta Reglamentadora del Cannabis Medicinal, adscrita al Departamento de Salud, la autoridad que licencia todo establecimiento de cannabis medicinal. Solo un dispensario licenciado por la Junta puede vender o despachar cannabis medicinal a pacientes registrados."),
    text("The dispensary license authorizes the medical cannabis operation at the licensed premises under the Junta's security, inventory-tracking and patient-verification rules. Entry is limited to patients and authorized adults 21 or older, and owners, directors and employees each need the Junta's occupational identification.", "La licencia de dispensario autoriza la operación de cannabis medicinal en el local licenciado bajo las reglas de seguridad, rastreo de inventario y verificación de pacientes de la Junta. La entrada se limita a pacientes y adultos autorizados de 21 años o más, y cada dueño, director y empleado necesita la identificación ocupacional de la Junta."),
    text("File the Junta's medical cannabis dispensary license application with the ownership disclosures, the security plan and the premises information, and request occupational identification for every owner and employee. Confirm with the permits office that the location's zoning allows a dispensary before signing a lease.", "Radica ante la Junta la solicitud de licencia de dispensario de cannabis medicinal con la divulgación de dueños, el plan de seguridad y la información del local, y solicita la identificación ocupacional para cada dueño y empleado. Confirma con la oficina de permisos que la calificación del local permite un dispensario antes de firmar el contrato."),
    text("Dispensing medical cannabis without the Junta's license is outside the protection of Ley 42-2017. The license is tied to the premises and owners on file; changes in either need the Junta's approval before they take effect.", "Despachar cannabis medicinal sin la licencia de la Junta queda fuera de la protección de la Ley 42-2017. La licencia está atada al local y a los dueños registrados; los cambios en cualquiera necesitan la aprobación de la Junta antes de entrar en vigor."),
  ]),
  DOC_TELECOM_TOWER_SITING: concept("DOC_TELECOM_TOWER_SITING", [
    [condition("businessType", "Telecommunications tower", "Torre de telecomunicaciones", "BT_TELECOM_TOWER")],
    [condition("project_type", "Construction project", "Proyecto de construcción")],
  ], [KB_GAP_SOURCES.ley89], [
    text("Puerto Rico's tower-siting law (Ley 89-2000) sets conditions every new telecommunications tower must meet in its construction permit: a minimum setback from the nearest residence (Art. 5), a sworn statement on sharing the tower with other carriers (Art. 7), and written notice to neighbors within 100 meters (Art. 8).", "La ley de ubicación de torres de Puerto Rico (Ley 89-2000) fija condiciones que toda torre de telecomunicaciones nueva debe cumplir en su permiso de construcción: una distancia mínima de la residencia más cercana (Art. 5), una declaración jurada sobre compartir la torre con otras compañías (Art. 7) y notificación escrita a los vecinos dentro de 100 metros (Art. 8)."),
    text("These siting conditions decide whether OGPe or the municipal permits office can approve the tower at that lot. In residential and rural districts the tower must stand back from the nearest residence by at least its height plus 10%.", "Estas condiciones de ubicación deciden si OGPe o la oficina de permisos municipal puede aprobar la torre en ese solar. En distritos residenciales y rurales la torre debe separarse de la residencia más cercana por lo menos su altura más un 10%."),
    text("Have the engineer confirm the setback on the site plan, prepare the co-location sworn statement, and send and document the neighbor notices before filing the tower's permit in the Single Business Portal.", "Pide al ingeniero que confirme la distancia en el plano de sitio, prepara la declaración jurada de coubicación, y envía y documenta las notificaciones a los vecinos antes de radicar el permiso de la torre en el Single Business Portal."),
    text("A tower file missing the setback, co-location statement or neighbor notice cannot be approved. After approval, the tower still needs the FAA and FCC filings that apply to its height and location.", "Un expediente de torre sin la distancia, la declaración de coubicación o la notificación a vecinos no se puede aprobar. Luego de aprobada, la torre todavía necesita las radicaciones ante la FAA y la FCC que apliquen según su altura y ubicación."),
  ]),
  DOC_FAA_7460_NOTICE: concept("DOC_FAA_7460_NOTICE", [
    [condition("businessType", "Telecommunications tower", "Torre de telecomunicaciones", "BT_TELECOM_TOWER")],
    [condition("project_type", "Construction project", "Proyecto de construcción")],
  ], [KB_GAP_SOURCES.faa77], [
    text("Federal aviation rules (14 CFR 77.9) require notice to the FAA before building any structure more than 200 feet above ground level, or a shorter structure near an airport or heliport that crosses the FAA's notice slope.", "Las reglas federales de aviación (14 CFR 77.9) exigen notificar a la FAA antes de construir cualquier estructura de más de 200 pies sobre el nivel del suelo, o una estructura más baja cerca de un aeropuerto o helipuerto que cruce la pendiente de notificación de la FAA."),
    text("The FAA notice (Form 7460-1) lets the FAA study whether the structure is a hazard to air navigation and set marking and lighting. Its determination is also the starting point for the FCC antenna structure registration.", "La notificación a la FAA (Formulario 7460-1) permite a la FAA estudiar si la estructura es un peligro para la navegación aérea y fijar la señalización y las luces. Su determinación es además el punto de partida del registro de estructura de antena ante la FCC."),
    text("Check the structure's height and the distance to the nearest airport with the FAA's notice-criteria tool, and if notice is needed, file Form 7460-1 online at least 45 days before construction starts.", "Verifica la altura de la estructura y la distancia al aeropuerto más cercano con la herramienta de criterios de la FAA y, si hace falta notificar, radica el Formulario 7460-1 en línea por lo menos 45 días antes de empezar la construcción."),
    text("Building without a required FAA notice exposes the owner to FAA enforcement and blocks the FCC registration. Follow the marking and lighting conditions in the FAA determination.", "Construir sin la notificación requerida a la FAA expone al dueño a acciones de la FAA y bloquea el registro ante la FCC. Cumple las condiciones de señalización y luces de la determinación de la FAA."),
  ]),
  DOC_FCC_ASR: concept("DOC_FCC_ASR", [
    [condition("businessType", "Telecommunications tower", "Torre de telecomunicaciones", "BT_TELECOM_TOWER")],
    [condition("project_type", "Construction project", "Proyecto de construcción")],
  ], [KB_GAP_SOURCES.fcc17], [
    text("FCC rules (47 CFR 17.4) require the owner of an antenna structure that needs FAA notice to register it with the FCC before the structure is used for licensed communications.", "Las reglas de la FCC (47 CFR 17.4) exigen que el dueño de una estructura de antena que necesita notificación a la FAA la registre ante la FCC antes de usarla para comunicaciones licenciadas."),
    text("The antenna structure registration ties the tower to its FAA determination and its required marking and lighting, so carriers licensed on the tower can rely on it.", "El registro de estructura de antena vincula la torre con su determinación de la FAA y la señalización y luces requeridas, para que las compañías licenciadas en la torre puedan usarla."),
    text("Once the FAA issues its no-hazard determination, file the antenna structure registration in the FCC's system and post the registration number at the base of the tower.", "Cuando la FAA emita su determinación de no peligro, radica el registro de estructura de antena en el sistema de la FCC y exhibe el número de registro en la base de la torre."),
    text("An unregistered antenna structure that needs registration exposes the owner to FCC fines. Keep the lighting monitored and report outages as the antenna structure registration requires.", "Una estructura de antena sin el registro requerido expone al dueño a multas de la FCC. Mantén las luces monitoreadas y reporta las fallas según lo exige el registro de estructura de antena."),
  ], ["DOC_FAA_7460_NOTICE"]),
  DOC_NET_TOWER_REGISTRY: concept("DOC_NET_TOWER_REGISTRY", [
    [condition("businessType", "Telecommunications tower", "Torre de telecomunicaciones", "BT_TELECOM_TOWER")],
  ], [KB_GAP_SOURCES.netRegistry], [
    text("The Negociado de Telecomunicaciones, part of the Junta Reglamentadora de Servicio Público, keeps an online tower registry of telecommunications towers in Puerto Rico under an administrative order.", "El Negociado de Telecomunicaciones, parte de la Junta Reglamentadora de Servicio Público, mantiene en línea un registro de torres de telecomunicaciones en Puerto Rico bajo una orden administrativa."),
    text("The tower registry gives the Negociado de Telecomunicaciones an inventory of tower locations and owners for planning and emergency coordination; it is not a construction permit.", "El registro de torres le da al Negociado de Telecomunicaciones un inventario de ubicaciones y dueños de torres para planificación y coordinación de emergencias; no es un permiso de construcción."),
    text("Ask the Negociado de Telecomunicaciones whether the new tower must be entered in its tower registry and what data it needs (location, height, owner, carriers).", "Pregunta al Negociado de Telecomunicaciones si la torre nueva debe inscribirse en su registro de torres y qué datos necesita (ubicación, altura, dueño, compañías)."),
    text("If the Negociado de Telecomunicaciones confirms registration applies, enter the tower before it goes into service and update the entry when ownership or carriers change.", "Si el Negociado de Telecomunicaciones confirma que la inscripción aplica, inscribe la torre antes de ponerla en servicio y actualiza la información cuando cambien el dueño o las compañías."),
  ]),
  DOC_DRNA_VESSEL_REGISTRATION: concept("DOC_DRNA_VESSEL_REGISTRATION", [
    [condition("businessType", "Watercraft rental", "Alquiler de embarcaciones", "BT_WATER_SPORTS_RENTAL")],
    [business],
  ], [KB_GAP_SOURCES.ley430], [
    text("Puerto Rico's Navigation and Water Safety Act (Ley 430-2000, Art. 9) requires every motorized vessel and jet ski used in Puerto Rico waters to be registered with the DRNA, which assigns the numbers displayed on the hull.", "La Ley de Navegación y Seguridad Acuática de Puerto Rico (Ley 430-2000, Art. 9) exige que toda embarcación de motor y moto acuática que se use en aguas de Puerto Rico esté inscrita en el DRNA, que asigna los números que se exhiben en el casco."),
    text("The vessel registration identifies each boat or jet ski and its owner and is checked by the DRNA rangers on the water. A rental fleet registers every unit it puts in the water.", "La inscripción de cada embarcación identifica el bote o la moto acuática y a su dueño, y los vigilantes del DRNA la verifican en el agua. Una flota de alquiler inscribe cada unidad que pone en el agua."),
    text("Register each vessel and jet ski with the DRNA, or confirm the existing registrations are current, and display the assigned numbers and decals before the vessel is used.", "Inscribe cada embarcación y moto acuática en el DRNA, o confirma que las inscripciones existentes están vigentes, y exhibe los números y marbetes asignados antes de usar la embarcación."),
    text("Operating an unregistered vessel exposes the business to DRNA citations and keeps the vessel off the water. Renew each vessel registration on schedule.", "Operar una embarcación sin inscribir expone al negocio a multas del DRNA y saca la embarcación del agua. Renueva la inscripción de cada embarcación a tiempo."),
  ]),
  DOC_DRNA_BOAT_RENTAL_LICENSE: concept("DOC_DRNA_BOAT_RENTAL_LICENSE", [
    [condition("businessType", "Watercraft rental", "Alquiler de embarcaciones", "BT_WATER_SPORTS_RENTAL")],
  ], [KB_GAP_SOURCES.ley430, KB_GAP_SOURCES.cp10], [
    text("Ley 430-2000, Art. 9(6)(g), sets specific duties for businesses that rent boats and jet skis, and the DRNA licenses rental-vessel owners on its application form CP-10.", "La Ley 430-2000, Art. 9(6)(g), fija deberes específicos para los negocios que alquilan botes y motos acuáticas, y el DRNA licencia a los dueños de botes de alquiler mediante su formulario CP-10."),
    text("The rental license makes the business responsible for a rental log, lifesaving training for staff, a licensed instructor's briefing for each renter, and the statute's minimum ages for renters and riders.", "La licencia de alquiler hace al negocio responsable de llevar un registro de alquileres, acreditar el adiestramiento de salvavidas del personal, que un instructor licenciado oriente a cada cliente del alquiler y cumplir las edades mínimas de la ley para quienes alquilan y conducen."),
    text("File the DRNA's rental-boat owner license application with the list of registered vessels, staff training certificates and the instructor's license, or confirm the existing rental license is current.", "Radica ante el DRNA la solicitud de licencia para dueños de bote de alquiler con la lista de embarcaciones inscritas, los certificados de adiestramiento del personal y la licencia del instructor, o confirma que la licencia de alquiler existente está vigente."),
    text("Renting vessels without the DRNA license exposes the business to fines and closure of the rental operation. Keep the rental log available for DRNA inspection.", "Alquilar embarcaciones sin la licencia del DRNA expone al negocio a multas y al cierre de la operación de alquiler. Mantén el registro de alquileres disponible para inspección del DRNA."),
  ], ["DOC_DRNA_VESSEL_REGISTRATION"]),
  DOC_DRNA_MARITIME_CONCESSION: concept("DOC_DRNA_MARITIME_CONCESSION", [
    [condition("businessType", "Marina or dock operator", "Marina o muelles", "BT_MARINA")],
    [condition("businessType", "Watercraft rental", "Alquiler de embarcaciones", "BT_WATER_SPORTS_RENTAL")],
  ], [KB_GAP_SOURCES.reg4860], [
    text("The maritime-terrestrial zone (the shore up to the reach of the highest tides) and the submerged lands under Puerto Rico's waters are public domain. DRNA Regulation 4860, Arts. 4.1–4.3, requires a DRNA concession or authorization for permanent works and commercial activities on them.", "La zona marítimo-terrestre (la costa hasta donde llegan las mareas más altas) y los terrenos sumergidos bajo las aguas de Puerto Rico son de dominio público. El Reglamento 4860 del DRNA, Arts. 4.1–4.3, exige una concesión o autorización del DRNA para obras permanentes y actividades comerciales en ellos."),
    text("The concession or authorization grants the right to occupy the public maritime-terrestrial zone or submerged lands for the docks, piers, moorings or activity described, for a set term and use fee.", "La concesión o autorización otorga el derecho a ocupar la zona marítimo-terrestre pública o los terrenos sumergidos para los muelles, amarres o la actividad descrita, por un término y un canon de uso."),
    text("Have the site's maritime-terrestrial boundary delineated and file the DRNA concession or authorization request with plans of every structure over the water or shore; if the business works from a marina that already holds a concession, confirm in writing whether that concession covers the business's activity.", "Pide la delimitación de la zona marítimo-terrestre del predio y radica ante el DRNA la solicitud de concesión o autorización con planos de cada estructura sobre el agua o la costa; si el negocio opera desde una marina que ya tiene concesión, confirma por escrito si esa concesión cubre la actividad del negocio."),
    text("Structures on the maritime-terrestrial zone or submerged lands without a DRNA concession can be ordered removed at the owner's cost. The concession is renewed and its use fee paid for as long as the structures remain.", "Las estructuras en la zona marítimo-terrestre o en terrenos sumergidos sin concesión del DRNA pueden ser removidas por orden y a costa del dueño. La concesión se renueva y su canon se paga mientras las estructuras permanezcan."),
  ]),
  DOC_USACE_SECTION10: concept("DOC_USACE_SECTION10", [
    [condition("businessType", "Marina or dock operator", "Marina o muelles", "BT_MARINA")],
  ], [KB_GAP_SOURCES.usace], [
    text("Section 10 of the federal Rivers and Harbors Act (33 U.S.C. 403; 33 CFR Part 322) requires a U.S. Army Corps of Engineers permit for docks, piers, pilings, moorings and other structures in navigable waters, which include Puerto Rico's coastal waters.", "La Sección 10 de la ley federal de Ríos y Puertos (33 U.S.C. 403; 33 CFR Parte 322) exige un permiso del Cuerpo de Ingenieros del Ejército de EE. UU. para muelles, pilotes, amarres y otras estructuras en aguas navegables, que incluyen las aguas costeras de Puerto Rico."),
    text("The Corps permit authorizes the structure's footprint in navigable waters after reviewing navigation, environmental and historic effects. Dredging or fill also brings Clean Water Act Section 404 review in the same Corps file.", "El permiso del Cuerpo de Ingenieros autoriza la huella de la estructura en aguas navegables después de revisar los efectos sobre la navegación, el ambiente y los recursos históricos. Un dragado o relleno añade la revisión de la Sección 404 de la Ley de Agua Limpia en el mismo expediente del Cuerpo de Ingenieros."),
    text("Before building or modifying any dock or mooring, contact the Corps' Antilles Regulatory Section with plans and location; existing marinas confirm their current structures are covered by a Corps permit.", "Antes de construir o modificar un muelle o amarre, contacta a la Sección Reguladora de las Antillas del Cuerpo de Ingenieros con los planos y la ubicación; las marinas existentes confirman que sus estructuras actuales están cubiertas por un permiso del Cuerpo de Ingenieros."),
    text("Structures built in navigable waters without a Section 10 permit can be ordered removed. The Corps permit is coordinated with the DRNA concession and the coastal-zone consistency review.", "Las estructuras construidas en aguas navegables sin permiso de la Sección 10 pueden ser removidas por orden. El permiso del Cuerpo de Ingenieros se coordina con la concesión del DRNA y la revisión de consistencia con la zona costanera."),
  ]),
  DOC_DRNA_RECYCLING_FACILITY_ENDORSEMENT: concept("DOC_DRNA_RECYCLING_FACILITY_ENDORSEMENT", [
    [condition("businessType", "Textile recycling", "Reciclaje textil", "BT_TEXTILE_RECYCLING")],
  ], [KB_GAP_SOURCES.recycling], [
    text("Puerto Rico's recycling law (Ley 70-1992) and the DRNA's recycling regulation (Cap. VIII, Reglas 2 and 4) bar any recycling or materials-recovery facility from operating without the DRNA's endorsement.", "La ley de reciclaje de Puerto Rico (Ley 70-1992) y el reglamento de reciclaje del DRNA (Cap. VIII, Reglas 2 y 4) prohíben que una instalación de reciclaje o recuperación de materiales opere sin el endoso del DRNA."),
    text("The recycling facility endorsement confirms the facility's processes, storage and residue disposal meet the DRNA's solid-waste program. It is valid for two years and is separate from the use permit for the building.", "El endoso de instalación de reciclaje confirma que los procesos, el almacenaje y la disposición de residuos de la instalación cumplen con el programa de desperdicios sólidos del DRNA. Vale por dos años y es aparte del permiso de uso del edificio."),
    text("File the DRNA's recycling-facility endorsement application with the description of the materials received, the sorting and processing steps, storage areas and where residues go, or confirm the existing endorsement is current.", "Radica ante el DRNA la solicitud de endoso de instalación de reciclaje con la descripción de los materiales que recibe, los pasos de clasificación y procesamiento, las áreas de almacenaje y el destino de los residuos, o confirma que el endoso existente está vigente."),
    text("Operating a recycling facility without the DRNA endorsement exposes it to DRNA orders and fines. Renew the endorsement every two years and file the recycling reports it requires.", "Operar una instalación de reciclaje sin el endoso del DRNA la expone a órdenes y multas del DRNA. Renueva el endoso cada dos años y radica los informes de reciclaje que exige."),
  ]),
  DOC_EPA_AUTOBODY_NESHAP_NOTICE: concept("DOC_EPA_AUTOBODY_NESHAP_NOTICE", [
    [condition("businessType", "Auto body shop", "Taller de hojalatería y pintura", "BT_BODY_SHOP")],
  ], [KB_GAP_SOURCES.neshap6h], [
    text("EPA's area-source coating rule (40 CFR Part 63, Subpart HHHHHH) covers every shop that spray-applies paints or coatings to motor vehicles or mobile equipment, however small (§ 63.11169).", "La regla de recubrimientos de fuentes de área de la EPA (40 CFR Parte 63, Subparte HHHHHH) cubre todo taller que aplica pintura o recubrimientos con pistola a vehículos de motor o equipo móvil, sin importar su tamaño (§ 63.11169)."),
    text("The rule sets how spray coating must be done: in a filtered spray booth, with high-efficiency spray guns, by painters trained and certified in the technique. The initial notification tells EPA the shop is subject to the rule.", "La regla fija cómo se debe aplicar la pintura con pistola: en una cabina con filtros, con pistolas de alta eficiencia y por pintores adiestrados y certificados en la técnica. La notificación inicial informa a la EPA que el taller está sujeto a la regla."),
    text("Before spray painting, set up the filtered booth and high-efficiency spray guns, train and certify every painter, and file the initial notification with EPA Region 2 (copy to DRNA), followed by the notification of compliance.", "Antes de aplicar pintura con pistola, instala la cabina con filtros y las pistolas de alta eficiencia, adiestra y certifica a cada pintor, y radica la notificación inicial ante la Región 2 de la EPA (con copia al DRNA), seguida de la notificación de cumplimiento."),
    text("Spray coating outside a compliant booth or without the notification violates the federal Clean Air Act rule. Keep painter training records and booth filter records for EPA inspection.", "Aplicar pintura con pistola fuera de una cabina conforme o sin la notificación viola la regla federal de la Ley de Aire Limpio. Guarda los récords de adiestramiento de pintores y de los filtros de la cabina para inspección de la EPA."),
  ]),
};
