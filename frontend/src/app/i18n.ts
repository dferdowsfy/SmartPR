// Central bilingual (English/Spanish) dictionary.
//
// L(text, lang) is an exact-match translator: pass the canonical English
// string and it returns the Spanish equivalent when lang === 'es', otherwise
// the original English. This lets us translate UI labels, requirement data,
// questions, findings, PDF text, and the workspace page from one place.

export type Lang = "en" | "es";

export const ES: Record<string, string> = {
  // ---- Navigation ----
  "Privacy Policy": "Política de privacidad",
  "Needs verification": "Necesita verificación",
  "Not applicable": "No aplica",
  "Review condition": "Condición de revisión",
  "Review conditions": "Condiciones de revisión",
  "Critical path — handle these next": "Ruta crítica — atienda estos ahora",
  "CRITICAL PATH — HANDLE THESE NEXT": "RUTA CRÍTICA — ATIENDE ESTOS AHORA",
  "These requirements are blocking your ability to move forward.": "Estos requisitos están bloqueando tu capacidad de avanzar.",
  "still missing": "aún faltan",
  "INCENTIVES YOU'RE PURSUING": "INCENTIVOS QUE ESTÁS PERSIGUIENDO",
  "View workflow": "Ver flujo de trabajo",
  "Remove": "Eliminar",
  "Added for": "Añadido para",
  "Pursuing": "Persiguiendo",
  "Review": "Revisar",
  "View all opportunities": "Ver todas las oportunidades",
  "Opportunities": "Oportunidades",
  "identified": "identificadas",
  // ---- Requirement guidance panel ----
  "Why you need this": "Por qué lo necesitas",
  "What this is": "Qué es esto",
  "What you'll do": "Qué harás",
  "Then what?": "¿Y luego qué?",
  "SmartPR identified this because:": "SmartPR identificó esto porque:",
  "Verified": "Verificado",
  "Why we ask": "Por qué lo preguntamos",
  "Needs Action": "Necesita acción",
  "Why do I need this?": "¿Por qué necesito esto?",
  "OTHER REQUIREMENTS": "OTROS REQUISITOS",
  "Step 2 of 3 — SmartPR shows you what you need and what to do next.": "Paso 2 de 3 — SmartPR te muestra lo que necesitas y qué hacer a continuación.",
  "Select entity type": "Seleccione el tipo de entidad",
  "Stock corporation": "Corporación con acciones",
  "Nonprofit non-stock corporation": "Corporación sin acciones sin fines de lucro",
  "Close / intimate corporation": "Corporación íntima",
  "Professional corporation": "Corporación profesional",
  "Foreign corporation seeking authorization in Puerto Rico": "Corporación foránea que solicita autorización en Puerto Rico",
  "Limited liability partnership": "Sociedad de responsabilidad limitada",
  "Limited liability company (LLC)": "Compañía de responsabilidad limitada (LLC)",
  "Sole proprietorship": "Empresa individual",
  "Partnership": "Sociedad",
  "Other / not sure": "Otro / no estoy seguro",
  "Start": "Comenzar",
  "History": "Historial",
  "Calendar": "Calendario",
  "Continue to documents": "Continuar a documentos",
  "Back to requirements": "Volver a requisitos",
  "Required documents": "Documentos requeridos",
  "Upload official": "Subir oficial",
  "Prepare application": "Preparar solicitud",
  "Knowledge Graph": "Grafo de Conocimiento",
  "Dashboard": "Panel",
  "My Businesses": "Mis Negocios",
  "Sign in": "Iniciar sesión",
  "Sign out": "Cerrar sesión",
  "Settings": "Configuración",
  // ---- Save & resume ----
  "Save Progress": "Guardar progreso",
  "Saved to your account — resume from History any time.": "Guardado en tu cuenta — puedes continuar desde Historial cuando quieras.",
  "Saving…": "Guardando…",
  "Saved": "Guardado",
  "Retry": "Reintentar",
  "Save": "Guardar",
  "Save this submission": "Guardar este envío",
  "Enter your email and we will save this assessment to your account when you sign in.": "Ingresa tu correo y guardaremos esta evaluación en tu cuenta cuando inicies sesión.",
  // ---- Extraction-first document validation ----
  "Classified as": "Clasificado como",
  "Validation Result": "Resultado de Validación",
  "Confidence Score": "Puntuación de Confianza",
  "Fields Found": "Campos Encontrados",
  "Fields Missing": "Campos Faltantes",
  "Reasoning": "Razonamiento",
  "Pass": "Aprobado",
  "Fail": "Falla",
  "Re-upload": "Volver a subir",
  "fields found": "campos encontrados",
  "required missing": "requeridos faltantes",
  // reasoning fragments
  "with": "con",
  "confidence": "de confianza",
  "Found": "Se encontraron",
  "fields": "campos",
  "Missing required": "Faltan requeridos",
  "Expiration is valid.": "La fecha de vencimiento es válida.",
  "Expiration has passed.": "La fecha de vencimiento ya pasó.",
  "All required fields are present and valid.": "Todos los campos requeridos están presentes y válidos.",
  "Required fields are missing — this document cannot be validated yet.": "Faltan campos requeridos — este documento aún no puede ser validado.",
  "Present but needs review before it can be accepted.": "Presente, pero necesita revisión antes de ser aceptado.",
  // field labels
  "Entity Name": "Nombre de la Entidad",
  "Owner / Authorized Person": "Dueño / Persona Autorizada",
  "Address": "Dirección",
  "Issue Date": "Fecha de Emisión",
  "Expiration Date": "Fecha de Vencimiento",
  "License / Permit Number": "Número de Licencia / Permiso",
  "Merchant Number": "Número de Comerciante",
  "Permit Number": "Número de Permiso",
  // ---- Relationship engine / potential requirements ----
  "Mandatory Required Items": "Documentos Obligatorios",
  "Potentially Required Items": "Documentos Posiblemente Requeridos",
  "Recommended Items": "Documentos Recomendados",
  "Potentially Required": "Posiblemente Requerido",
  "Why this may be required": "Por qué podría ser requerido",
  "Why is this required?": "¿Por qué se requiere esto?",
  "Hide reasons": "Ocultar razones",
  "Applies": "Aplica",
  "Does Not Apply": "No Aplica",
  "Not Sure": "No sé",
  "Not sure": "No sé",
  "Confirmed — applies": "Confirmado — aplica",
  "Trigger": "Origen",
  "Advisory": "Orientativo",
  "Recommended Based on Similar Businesses": "Recomendado Según Negocios Similares",
  "Kept as potentially required. Revisit before submission.": "Se mantiene como posiblemente requerido. Revísalo antes de enviar.",
  "Undo — mark as not sure": "Deshacer — marcar como no estoy seguro",
  "Based on": "Basado en",
  "similar businesses processed before. Suggestions only — these never change what the rules require.":
    "negocios similares procesados anteriormente. Solo sugerencias — nunca cambian lo que exigen las reglas.",
  "Documents similar businesses often also needed": "Documentos que negocios similares también necesitaron",
  "Documents that commonly fail validation": "Documentos que comúnmente fallan la validación",
  "Operations": "Operaciones",
  "Location": "Ubicación",
  "Baseline": "Base",
  "Agency": "Agencia",
  "Island Municipality": "Municipio Isla",
  "Coastal Municipality": "Municipio Costero",
  "Tourism Municipality": "Municipio Turístico",
  "Historic District Municipality": "Municipio con Distrito Histórico",
  "Major Metro Municipality": "Municipio Metropolitano",
  // ---- Step 1 / header / nav ----
  "SmartPR Readiness Workflow": "Flujo de Preparación SmartPR",
  "Step": "Paso",
  "of": "de",
  "All relevant questions answered for this business type.":
    "Todas las preguntas relevantes para este tipo de negocio han sido respondidas.",
  "Question": "Pregunta",

  // ---- Dynamic discovery questions ----
  "Will food be prepared on-site?": "¿Se preparará comida en el local?",
  "Will customers consume food on-site?": "¿Los clientes consumirán comida en el local?",
  "Will alcohol be sold?": "¿Se venderá alcohol?",
  "Will there be outdoor seating?": "¿Habrá asientos al aire libre?",
  "Will there be live entertainment?": "¿Habrá entretenimiento en vivo?",
  "Will food be delivered?": "¿Se entregará comida a domicilio?",
  "Will employees work on-site?": "¿Trabajarán empleados en el local?",
  "Will this operate from a food truck or mobile unit?":
    "¿Operará desde un food truck o unidad móvil?",
  "Will patients visit this location?": "¿Los pacientes visitarán este local?",
  "Will controlled substances be stored?": "¿Se almacenarán sustancias controladas?",
  "Will medical waste be generated?": "¿Se generarán residuos médicos?",
  "Will diagnostic testing be performed?": "¿Se realizarán pruebas diagnósticas?",
  "Will healthcare professionals provide services?":
    "¿Profesionales de la salud prestarán servicios?",
  "Will clients visit your location?": "¿Los clientes visitarán su local?",
  "Will licensed professionals provide services?":
    "¿Profesionales licenciados prestarán servicios?",
  "Will employees be hired?": "¿Se contratarán empleados?",
  "Will services be delivered entirely online?":
    "¿Los servicios se prestarán completamente en línea?",
  "Will employees work from a physical office?":
    "¿Los empleados trabajarán desde una oficina física?",
  "Will customers visit the location?": "¿Los clientes visitarán el local?",
  "Will inventory be stored?": "¿Se almacenará inventario?",
  "Will hardware be sold?": "¿Se venderá hardware (equipos)?",
  "Will products be stored on-site?": "¿Se almacenarán productos en el local?",
  "Will food be sold?": "¿Se venderá comida?",
  "Will deliveries be made?": "¿Se realizarán entregas?",
  "Will commercial vehicles be used?": "¿Se utilizarán vehículos comerciales?",
  "Will hazardous materials be stored?": "¿Se almacenarán materiales peligrosos?",
  "Will equipment be stored at a facility?": "¿Se almacenará equipo en una instalación?",
  "Will guests stay overnight?": "¿Los huéspedes se hospedarán durante la noche?",
  "Will food be served?": "¿Se servirá comida?",
  "Will alcohol be served?": "¿Se servirá alcohol?",
  "Will water activities be offered?": "¿Se ofrecerán actividades acuáticas?",
  "Will customers receive services on-site?":
    "¿Los clientes recibirán servicios en el local?",
  "Will needles or invasive procedures be used?":
    "¿Se utilizarán agujas o procedimientos invasivos?",
  "Will biohazard waste be generated?": "¿Se generarán residuos biopeligrosos?",
  "Will products be manufactured on-site?": "¿Se fabricarán productos en el local?",
  "Will products be distributed?": "¿Se distribuirán productos?",
  "Will goods be stored?": "¿Se almacenarán mercancías?",
  "Will hazardous materials be transported?": "¿Se transportarán materiales peligrosos?",
  "Will children be present?": "¿Habrá niños presentes?",
  "Will classes be held on-site?": "¿Se impartirán clases en el local?",
  "Will clients visit the office?": "¿Los clientes visitarán la oficina?",
  "Will properties be managed on behalf of others?":
    "¿Se administrarán propiedades en nombre de terceros?",
  "Will vehicles be repaired?": "¿Se repararán vehículos?",
  "Will hazardous fluids be stored?": "¿Se almacenarán fluidos peligrosos?",
  "Will customers visit the facility?": "¿Los clientes visitarán la instalación?",
  "Will food products be sold?": "¿Se venderán productos alimenticios?",
  "Will chemicals be stored?": "¿Se almacenarán productos químicos?",
  "Will the business operate from a physical location?":
    "¿El negocio operará desde una ubicación física?",
  "Will professional licenses be required?": "¿Se requerirán licencias profesionales?",
  "Will clients or members visit?": "¿Visitarán clientes o miembros?",

  // ---- Requirement names ----
  "Certificate of Incorporation / LLC Formation":
    "Certificado de Incorporación / Formación de LLC",
  "IRS EIN Confirmation Letter": "Carta de Confirmación de EIN del IRS",
  "Merchant Registration Certificate (Registro de Comerciante)":
    "Certificado de Registro de Comerciante",
  "Single Use Permit / Permiso Único": "Permiso Único",
  "Health / Sanitary Permit": "Permiso de Salud / Sanitario",
  "Fire Safety Certification (Certificado de Bomberos)":
    "Certificación de Seguridad contra Incendios (Certificado de Bomberos)",
  "Certified Food Protection Manager (CFPM)":
    "Gerente Certificado de Protección de Alimentos (CFPM)",
  "Alcohol Sales / Beverage Permit": "Permiso de Venta de Alcohol / Bebidas",
  "Lease Agreement or Property Docs + Floor Plans / Photos":
    "Contrato de Arrendamiento o Documentos de Propiedad + Planos / Fotos",
  "Contractor License / Trade Certification":
    "Licencia de Contratista / Certificación de Oficio",
  "CRIM Property Tax Clearance": "Certificación de Deuda del CRIM",
  "Professional Licenses for Staff": "Licencias Profesionales del Personal",
  "Professional Liability / E&O Insurance":
    "Seguro de Responsabilidad Profesional / E&O",
  "Environmental / Manufacturing Permit": "Permiso Ambiental / de Manufactura",
  "Transportation / PUC Permit": "Permiso de Transporte / Comisión de Servicio Público",
  "Tourism / Short-Term Rental Permit":
    "Permiso de Turismo / Alquiler a Corto Plazo",
  "Health / Sanitation Permit (Beauty)": "Permiso de Salud / Sanitario (Belleza)",
  "Education / Childcare License": "Licencia de Educación / Cuidado Infantil",
  "Short-Term Rental / Tourism Registration":
    "Registro de Alquiler a Corto Plazo / Turismo",
  "Sign Permit / Rótulo Permit": "Permiso de Rótulo",
  "Outdoor Seating Authorization": "Autorización de Asientos al Aire Libre",
  "Entertainment Permit": "Permiso de Entretenimiento",
  "Import / Export Registration": "Registro de Importación / Exportación",
  "Proof of Residential Address": "Prueba de Dirección Residencial",
  "Home Business Declaration": "Declaración de Negocio en el Hogar",
  "Tattoo / Body Art Health Authorization":
    "Autorización Sanitaria de Tatuajes / Arte Corporal",
  "Patente Municipal": "Patente Municipal",
  "Municipal Registration": "Registro Municipal",
  "Municipal Tax Compliance": "Cumplimiento de Impuestos Municipales",

  // ---- Municipality notices ----
  "Municipal Notices": "Avisos Municipales",
  "MUNICIPAL NOTICES": "AVISOS MUNICIPALES",
  "Additional coastal or environmental review may apply.":
    "Puede aplicar una revisión costera o ambiental adicional.",
  "Tourism registration and additional tourism-related requirements may apply.":
    "Pueden aplicar el registro de turismo y requisitos adicionales relacionados con el turismo.",
  "Historic district restrictions may apply depending on business location.":
    "Pueden aplicar restricciones de distrito histórico según la ubicación del negocio.",
  "Additional transportation and logistics requirements may apply for island municipalities.":
    "Pueden aplicar requisitos adicionales de transporte y logística para municipios isleños.",

  // ---- Agencies ----
  "Department of State": "Departamento de Estado",
  "Municipal Government": "Gobierno Municipal",
  "Hacienda (SURI)": "Hacienda (SURI)",
  "Departamento de Salud": "Departamento de Salud",
  "Cuerpo de Bomberos": "Cuerpo de Bomberos",
  "Hacienda / OGPe": "Hacienda / OGPe",
  "OGPe / Municipal": "OGPe / Municipal",
  "Department of State Examining Boards":
    "Juntas Examinadoras del Departamento de Estado",
  "Various": "Varias",
  "Environmental Quality Board / OGPe": "Junta de Calidad Ambiental / OGPe",
  "Public Service Commission": "Comisión de Servicio Público",
  "Tourism Company / Municipal": "Compañía de Turismo / Municipal",
  "Department of Education / Licensing Board":
    "Departamento de Educación / Junta de Licencias",
  "Municipal Government / OGPe": "Gobierno Municipal / OGPe",
  "Hacienda / Customs": "Hacienda / Aduanas",
  "General": "General",

  // ---- Requirement reasons ----
  "Required for all formal business entities in Puerto Rico.":
    "Requerido para todas las entidades comerciales formales en Puerto Rico.",
  "Federal tax ID required for all businesses operating in PR.":
    "Número de identificación fiscal federal requerido para todos los negocios que operan en PR.",
  "Mandatory to legally operate as a merchant and collect sales tax (IVU).":
    "Obligatorio para operar legalmente como comerciante y cobrar el impuesto sobre ventas (IVU).",
  "Consolidates use permit, zoning, and often fire/sanitary approvals via the Single Business Portal.":
    "Consolida el permiso de uso, la zonificación y a menudo las aprobaciones de bomberos/sanitarias a través del Portal Único.",
  "Required for any business preparing or serving food. Follows FDA Food Code (CFPM also needed).":
    "Requerido para cualquier negocio que prepare o sirva comida. Sigue el Código de Alimentos de la FDA (también se necesita CFPM).",
  "Fire prevention and safety inspection certificate required for physical commercial locations, especially food service.":
    "Certificado de prevención de incendios e inspección de seguridad requerido para locales comerciales físicos, especialmente de servicio de comida.",
  "Person-in-charge must hold current accredited CFPM certification for potentially hazardous food handling.":
    "La persona a cargo debe tener una certificación CFPM acreditada y vigente para el manejo de alimentos potencialmente peligrosos.",
  "Additional licensing for alcohol sales and service.":
    "Licencia adicional para la venta y servicio de alcohol.",
  "Proof of legal right to use the commercial space. Required for Permiso Único and most municipal approvals.":
    "Prueba del derecho legal a usar el espacio comercial. Requerido para el Permiso Único y la mayoría de las aprobaciones municipales.",
  "Required for construction trades and public work.":
    "Requerido para oficios de construcción y obra pública.",
  "Often requested by municipalities for Patente.":
    "Frecuentemente solicitado por los municipios para la Patente.",
  "Required for attorneys, CPAs, insurance agents, real estate brokers, engineers, architects, etc.":
    "Requerido para abogados, CPA, agentes de seguros, corredores de bienes raíces, ingenieros, arquitectos, etc.",
  "Strongly recommended for professional service providers.":
    "Muy recomendado para proveedores de servicios profesionales.",
  "Required for manufacturing operations, especially food, pharma, or chemical.":
    "Requerido para operaciones de manufactura, especialmente de alimentos, farmacéutica o química.",
  "Required for trucking, courier, taxi, rideshare, and logistics companies.":
    "Requerido para empresas de camiones, mensajería, taxi, transporte compartido y logística.",
  "Often required for hotels, resorts, Airbnbs, and tour operators.":
    "Frecuentemente requerido para hoteles, resorts, Airbnbs y operadores turísticos.",
  "Required for salons, spas, tattoo shops, and cosmetic services.":
    "Requerido para salones, spas, estudios de tatuajes y servicios cosméticos.",
  "Required for private schools, daycares, and vocational training.":
    "Requerido para escuelas privadas, guarderías y formación vocacional.",
  "Required for short-term rentals, hotels, resorts, and tourism activities.":
    "Requerido para alquileres a corto plazo, hoteles, resorts y actividades turísticas.",
  "Exterior signage may require municipal or permit approval.":
    "Los rótulos exteriores pueden requerir aprobación municipal o de permiso.",
  "Public space or sidewalk use approval may be required for outdoor seating.":
    "Puede requerirse aprobación de uso de espacio público o acera para asientos al aire libre.",
  "May be required for live entertainment.":
    "Puede requerirse para entretenimiento en vivo.",
  "Required if import/export activity occurs.":
    "Requerido si ocurre actividad de importación/exportación.",
  "Required for home-based businesses.":
    "Requerido para negocios basados en el hogar.",
  "Required for tattoo and body art services.":
    "Requerido para servicios de tatuajes y arte corporal.",

  // ---- Step 2 / checklist UI ----
  "SMARTPR READINESS CHECKLIST": "LISTA DE PREPARACIÓN SMARTPR",
  "Your Business": "Su Negocio",
  "READINESS SCORE": "PUNTUACIÓN DE PREPARACIÓN",
  "mandatory complete": "obligatorios completados",
  "Required Items for this business": "Requisitos para este negocio",
  "Compute Requirements from Rules Engine":
    "Calcular requisitos con el motor de reglas",
  "Mandatory": "Obligatorio",
  "Recommended": "Recomendado",
  "Upload": "Subir",
  "Complete": "Completo",
  "conf": "conf",
  "Needs Review": "Necesita Revisión",
  "Missing Information": "Falta Información",
  "Mismatch": "Discrepancia",
  "Expired": "Vencido",
  "Run Validation Engine": "Ejecutar Motor de Validación",
  "All required documents validated.":
    "Todos los documentos requeridos fueron validados.",
  "View SUBMISSION DELIVERABLES": "Ver ENTREGABLES DE SOLICITUD",
  "Findings": "Hallazgos",
  "SUBMISSION DELIVERABLES": "ENTREGABLES DE SOLICITUD",
  "SmartPR provides AI-assisted readiness assessment and document organization for Puerto Rico business licensing.":
    "SmartPR ofrece evaluación de preparación asistida por IA y organización de documentos para la concesión de licencias comerciales en Puerto Rico.",
  "Back to Discovery": "Volver al Descubrimiento",
  "Skip to next step": "Saltar al siguiente paso",

  // ---- Toasts ----
  "Could not analyze with AI": "No se pudo analizar con IA",
  "Add XAI_API_KEY in your environment to enable AI analysis.":
    "Agregue XAI_API_KEY en su entorno para habilitar el análisis con IA.",
  "AI analysis unavailable. Using basic classification.":
    "Análisis de IA no disponible. Usando clasificación básica.",
  "passed": "aprobado",
  "needs review": "necesita revisión",
  "AI verified": "La IA verificó",
  "Readiness score updated.": "Puntuación de preparación actualizada.",
  "AI analyzed": "La IA analizó",
  "but couldn't fully verify it.": "pero no pudo verificarlo por completo.",
  "verified": "verificado",
  "has issues": "tiene problemas",
  "processed": "procesado",
  "Identified as": "Identificado como",
  "Confidence": "Confianza",
  "Review fields or re-upload.": "Revise los campos o vuelva a subir.",
  "Document added and analyzed.": "Documento agregado y analizado.",
  "Address before submission.": "Resuélvalo antes de la solicitud.",

  // ---- Findings (client-generated) ----
  "Critical Items Missing": "Requisitos Críticos Faltantes",
  "Required documents or permits have not been uploaded or validated.":
    "No se han subido o validado los documentos o permisos requeridos.",
  "Upload the missing items shown in the checklist.":
    "Suba los elementos faltantes que aparecen en la lista.",
  "Insurance expires soon": "El seguro vence pronto",
  "One of your insurance certificates is approaching expiration.":
    "Uno de sus certificados de seguro está por vencer.",
  "Renew and re-upload the certificate before submission.":
    "Renueve y vuelva a subir el certificado antes de la solicitud.",
  "Municipal recommendation recommended": "Se recomienda recomendación municipal",
  "Some municipalities require a local planning letter.":
    "Algunos municipios requieren una carta de planificación local.",
  "Contact your municipal Oficina de Planificación.":
    "Comuníquese con la Oficina de Planificación de su municipio.",

  // ---- Deliverables screen (Step 9) ----
  "FINAL STEP": "PASO FINAL",
  "All validated materials are ready. This platform prepares you for submission — it does not file with government.":
    "Todos los materiales validados están listos. Esta plataforma lo prepara para la solicitud — no realiza la radicación ante el gobierno.",
  "Business Name": "Nombre del Negocio",
  "Municipality": "Municipio",
  "Business Type": "Tipo de Negocio",
  "Readiness Score": "Puntuación de Preparación",
  "READY FOR SUBMISSION": "LISTO PARA SOLICITUD",
  "IN PROGRESS — REVIEW REQUIRED": "EN PROGRESO — REQUIERE REVISIÓN",
  "Required Documents Validated": "Documentos Requeridos Validados",
  "No Critical Issues Found": "No se encontraron problemas críticos",
  "1. DOWNLOAD READINESS REPORT": "1. DESCARGAR INFORME DE PREPARACIÓN",
  "Professional PDF with Business Profile, Readiness Score, Validation Summary, Required/Uploaded/Missing Documents, Findings, Warnings, and Recommended Next Steps.":
    "PDF profesional con perfil del negocio, puntuación de preparación, resumen de validación, documentos requeridos/subidos/faltantes, hallazgos, advertencias y próximos pasos recomendados.",
  "Human-readable summary for your records, attorney, or consultant.":
    "Resumen legible para sus archivos, abogado o consultor.",
  "Download PDF Report": "Descargar Informe PDF",
  "2. DOWNLOAD SUBMISSION PACKAGE ZIP": "2. DESCARGAR PAQUETE ZIP DE SOLICITUD",
  "Complete ZIP containing the Readiness Report PDF + all your validated uploaded documents, automatically renamed and sorted in submission order:":
    "ZIP completo con el Informe de Preparación en PDF + todos sus documentos validados, renombrados y ordenados automáticamente en orden de solicitud:",
  "Ready to share with accountants, attorneys, municipalities, or permit expediters.":
    "Listo para compartir con contadores, abogados, municipios o gestores de permisos.",
  "Download ZIP Package": "Descargar Paquete ZIP",
  "3. OPEN SMARTPR WORKSPACE": "3. ABRIR ESPACIO DE TRABAJO SMARTPR",
  "Permanent link to your readiness workspace. Stores profile, questionnaire responses, required & uploaded documents, validation results, reports, and activity history.":
    "Enlace permanente a su espacio de trabajo de preparación. Guarda el perfil, las respuestas del cuestionario, los documentos requeridos y subidos, los resultados de validación, los informes y el historial de actividad.",
  "Future uploads and re-validation supported.":
    "Se admiten futuras cargas y revalidación.",
  "Open Workspace": "Abrir Espacio de Trabajo",
  "IMPORTANT DISCLAIMER — READ CAREFULLY":
    "AVISO IMPORTANTE — LEA CON ATENCIÓN",
  "Do NOT submit this package or any SmartPR output to government agencies as an official filing.":
    "NO presente este paquete ni ninguna salida de SmartPR a agencias gubernamentales como radicación oficial.",
  "Do NOT claim that SmartPR approves, grants, or issues any license or permit.":
    "NO afirme que SmartPR aprueba, otorga o emite ninguna licencia o permiso.",
  "Do NOT file permits or applications using these materials as the sole source.":
    "NO radique permisos ni solicitudes usando estos materiales como única fuente.",
  "readiness and compliance preparation platform":
    "plataforma de preparación de cumplimiento y preparación",
  "not a government filing system.": "no es un sistema de radicación gubernamental.",
  "SmartPR is a": "SmartPR es una",
  "The platform's responsibility ends at:":
    "La responsabilidad de la plataforma termina en:",
  "All final approvals are made exclusively by the Government of Puerto Rico and its agencies.":
    "Todas las aprobaciones finales las realiza exclusivamente el Gobierno de Puerto Rico y sus agencias.",
  "Data is stored for this workspace session. All analysis uses the configured AI model.":
    "Los datos se guardan para esta sesión de espacio de trabajo. Todo el análisis usa el modelo de IA configurado.",
  "Back to Checklist": "Volver a la Lista",
  "Start New Business": "Iniciar Nuevo Negocio",

  // ---- Workspace modal ----
  "Workspace": "Espacio de Trabajo",
  "Your readiness workspace opened in a new tab. This is a shareable, self-contained link showing your AI-approved deliverables, requirements checklist, and findings. The link has also been copied to your clipboard.":
    "Su espacio de trabajo se abrió en una pestaña nueva. Es un enlace compartible y autónomo que muestra sus entregables aprobados por IA, la lista de requisitos y los hallazgos. El enlace también se copió al portapapeles.",
  "Share it with your attorney, accountant, or permit expediter — it renders anywhere without a login.":
    "Compártalo con su abogado, contador o gestor de permisos — se muestra en cualquier lugar sin iniciar sesión.",
  "Open Workspace Again": "Abrir Espacio de Trabajo de Nuevo",
  "Close": "Cerrar",

  // ---- PDF report ----
  "NEEDS REVIEW": "NECESITA REVISIÓN",
  "SmartPR determines READINESS for submission to Puerto Rico government agencies. It does NOT approve, grant, or issue any license or permit. All approvals are made exclusively by the Government of Puerto Rico and its agencies. This package is for preparation and organization only. Platform scope: Prepare, Validate, Organize, Package.":
    "SmartPR determina la PREPARACIÓN para la solicitud ante agencias gubernamentales de Puerto Rico. NO aprueba, otorga ni emite ninguna licencia o permiso. Todas las aprobaciones las realiza exclusivamente el Gobierno de Puerto Rico y sus agencias. Este paquete es solo para preparación y organización. Alcance de la plataforma: Preparar, Validar, Organizar, Empaquetar.",
  "Submission Readiness Report": "Informe de Preparación de Solicitud",
  "Industry": "Industria",
  "Readiness": "Preparación",
  "required documents validated": "documentos requeridos validados",
  "REQUIRED DOCUMENTS": "DOCUMENTOS REQUERIDOS",
  "UPLOADED & VALIDATED DOCUMENTS": "DOCUMENTOS SUBIDOS Y VALIDADOS",
  "No documents uploaded yet.": "Aún no se han subido documentos.",
  "MISSING / PENDING DOCUMENTS": "DOCUMENTOS FALTANTES / PENDIENTES",
  "None — all mandatory items validated.":
    "Ninguno — todos los elementos obligatorios fueron validados.",
  "FINDINGS & RECOMMENDATIONS": "HALLAZGOS Y RECOMENDACIONES",
  "No findings recorded.": "No se registraron hallazgos.",
  "RECOMMENDED NEXT STEPS": "PRÓXIMOS PASOS RECOMENDADOS",
  "1. Review any items marked Needs Review or Warning.":
    "1. Revise los elementos marcados como Necesita Revisión o Advertencia.",
  "2. Address expiring documents or mismatches before submission.":
    "2. Resuelva los documentos por vencer o las discrepancias antes de la solicitud.",
  "3. Share the Submission Package ZIP with your attorney, accountant, or permit expediter.":
    "3. Comparta el paquete ZIP con su abogado, contador o gestor de permisos.",
  "4. Use the SmartPR Workspace to track updates and re-validate as needed.":
    "4. Use el Espacio de Trabajo SmartPR para dar seguimiento y revalidar según sea necesario.",
  "... and": "... y",
  "more": "más",
  "Generated": "Generado",
  "Page": "Página",

  // ---- Workspace page ----
  "Loading workspace…": "Cargando espacio de trabajo…",
  "Workspace not found": "Espacio de trabajo no encontrado",
  "This workspace link is missing its data. Re-open the workspace from the SmartPR deliverables screen to generate a fresh shareable link.":
    "A este enlace de espacio de trabajo le faltan los datos. Vuelva a abrir el espacio de trabajo desde la pantalla de entregables de SmartPR para generar un enlace nuevo y compartible.",
  "Go to SmartPR": "Ir a SmartPR",
  "Readiness Workspace": "Espacio de Trabajo de Preparación",
  "Approved Deliverables": "Entregables Aprobados",
  "No deliverables have been approved by the AI yet.":
    "La IA aún no ha aprobado ningún entregable.",
  "Uploaded — Needs Review": "Subidos — Necesitan Revisión",
  "Requirements Checklist": "Lista de Requisitos",
  "Findings & Recommendations": "Hallazgos y Recomendaciones",
  "SmartPR determines READINESS for submission to Puerto Rico government agencies. It does NOT approve, grant, or issue any license or permit. All approvals are made exclusively by the Government of Puerto Rico and its agencies. This workspace is for preparation and organization only.":
    "SmartPR determina la PREPARACIÓN para la solicitud ante agencias gubernamentales de Puerto Rico. NO aprueba, otorga ni emite ninguna licencia o permiso. Todas las aprobaciones las realiza exclusivamente el Gobierno de Puerto Rico y sus agencias. Este espacio de trabajo es solo para preparación y organización.",
  "PUERTO RICO BUSINESS LICENSING READINESS":
    "PREPARACIÓN PARA LICENCIAS COMERCIALES DE PUERTO RICO",
  "Powered by AI": "Desarrollado con IA",

  // ---- Validador design system: navigation tabs ----
  "Intake": "Registro",
  "Requirements": "Requisitos",
  "Deliverables": "Entregables",
  "Guest": "Invitado",
  "Not signed in": "Sesión no iniciada",

  // ---- Readiness states / status pills ----
  "Ready For Submission": "Listo para Envío",
  "Nearly Ready": "Casi Listo",
  "In Progress": "En Progreso",
  "Getting Started": "Comenzando",
  "Confirmed": "Confirmado",
  "Required": "Requerido",
  "Optional": "Opcional",
  "Ready": "Listo",
  "Waiting": "En espera",
  "Shareable": "Compartible",
  "Completed": "Completados",
  "Missing": "Faltantes",
  "All": "Todos",
  "To do": "Pendientes",
  "Done": "Listos",

  // ---- Intake view ----
  "Business profile": "Perfil del negocio",
  "Discovery": "Descubrimiento",
  "Business basics": "Datos básicos del negocio",
  "This applies to my business": "Esto aplica a mi negocio",
  "This does not apply": "Esto no aplica",
  "completed": "completado",
  "Back": "Atrás",
  "See my requirements": "Ver mis requisitos",
  "Questions completed": "Preguntas completadas",
  "Agencies identified": "Agencias identificadas",
  "Requirements discovered": "Requisitos descubiertos",
  "Licenses detected": "Licencias detectadas",
  "You don't need to know everything yet.": "No necesitas saberlo todo todavía.",
  "Anything missing is flagged later — you will always know what is next.":
    "Lo que falte se señalará más adelante — siempre sabrás qué sigue.",
  "Reviewing live": "Revisando en vivo",
  "Regulatory intelligence": "Inteligencia regulatoria",
  "Updating as you answer — like a senior compliance reviewer over your shoulder.":
    "Se actualiza mientras respondes — como un revisor de cumplimiento experto a tu lado.",
  "Launch readiness": "Preparación para operar",
  "Estimated": "Estimado",
  "Early discovery": "Descubrimiento inicial",
  "Mid discovery": "Descubrimiento intermedio",
  "Late discovery": "Descubrimiento avanzado",
  "Discovery complete": "Descubrimiento completo",
  "Agencies involved": "Agencias involucradas",
  "Select a municipality and business type to begin.":
    "Selecciona un municipio y tipo de negocio para comenzar.",
  "Potential obligations": "Obligaciones potenciales",
  "Licenses": "Licencias",
  "detected": "detectados",
  "Permits": "Permisos",
  "Certifications": "Certificaciones",
  "Registrations": "Registros",
  "Live recommendations": "Recomendaciones en vivo",
  "Recommendations appear as your profile takes shape.":
    "Las recomendaciones aparecen a medida que tu perfil toma forma.",

  // ---- Requirements view ----
  "Back to intake": "Volver al registro",
  "Your requirements": "Tus requisitos",
  "Every license, permit, inspection, and document discovered for your business — grouped by what to do next.":
    "Cada licencia, permiso, inspección y documento descubierto para tu negocio — agrupados por lo que debes hacer.",
  "Missing — handle these next": "Faltan — atiende estos primero",
  "Completed — looking good": "Completados — todo en orden",
  "Additional Requirements Based on Your Answers": "Requisitos Adicionales Según Tus Respuestas",
  "Undo": "Deshacer",
  "Triggered because": "Activado porque",
  "Recommendations": "Recomendaciones",
  "of similar businesses required this.": "de negocios similares requirieron esto.",
  "Focus on the missing items first.": "Concéntrate primero en los elementos faltantes.",
  "They move your readiness score the most and unblock everything downstream.":
    "Son los que más mejoran tu puntuación de preparación y desbloquean todo lo demás.",
  "Continue to deliverables": "Continuar a entregables",

  // ---- Deliverables view ----
  "Documents": "Documentos",
  "Readiness Report (PDF)": "Informe de Preparación (PDF)",
  "Business profile & readiness score": "Perfil del negocio y puntuación de preparación",
  "Required, uploaded & missing documents": "Documentos requeridos, subidos y faltantes",
  "Findings & recommended next steps": "Hallazgos y próximos pasos recomendados",
  "Submission Package (ZIP)": "Paquete de Envío (ZIP)",
  "Report + validated documents, renamed and sorted in submission order.":
    "Informe + documentos validados, renombrados y ordenados según el orden de envío.",
  "Package readiness": "Preparación del paquete",
  "documents": "documentos",
  "Permanent, shareable link to your readiness workspace.":
    "Enlace permanente y compartible a tu espacio de trabajo de preparación.",
  "Profile & questionnaire responses": "Perfil y respuestas del cuestionario",
  "Requirements & validation results": "Requisitos y resultados de validación",
  "Renders anywhere without a login": "Se visualiza en cualquier lugar sin iniciar sesión",
  "Need to make changes?": "¿Necesitas hacer cambios?",
  "Go back to the checklist to upload more documents, or start a new assessment.":
    "Vuelve a la lista para subir más documentos, o inicia una nueva evaluación.",
  // ---- Deliverables / application worksheet ----
  "Add PDF to deliverables": "Agregar PDF a entregables",
  "Answered from your description": "Respondido a partir de tu descripción",
  "Application prepared": "Solicitud preparada",
  "Application prepared and added to deliverables.": "Solicitud preparada y agregada a entregables.",
  "Application prepared — official evidence still required": "Solicitud preparada — aún se requiere evidencia oficial",
  "Application worksheet prepared": "Hoja de trabajo de solicitud preparada",
  "Back to edit": "Volver a editar",
  "Change": "Cambiar",
  "Chat with SmartPR": "Chatear con SmartPR",
  "Close form": "Cerrar formulario",
  "Close preview": "Cerrar vista previa",
  "Continue application": "Continuar solicitud",
  "Core Application Details": "Detalles Principales de la Solicitud",
  "Document preview": "Vista previa del documento",
  "Download PDF": "Descargar PDF",
  "Draft saved.": "Borrador guardado.",
  "Draft — official output still required": "Borrador — aún se requiere el documento oficial",
  "Edit business profile": "Editar perfil del negocio",
  "Fillable preparation drafts. Official agency-issued documents are still required.":
    "Borradores de preparación editables. Aún se requieren los documentos oficiales emitidos por la agencia.",
  "Generating preview…": "Generando vista previa…",
  "Go back to requirements to upload more evidence, or edit the business profile.":
    "Vuelve a los requisitos para subir más evidencia, o edita el perfil del negocio.",
  "Included in the Submission Package ZIP": "Incluido en el ZIP del Paquete de Envío",
  "Marked as submitted": "Marcado como enviado",
  "Marked as submitted — official evidence still required": "Marcado como enviado — aún se requiere evidencia oficial",
  "Marked as submitted. Upload the official document once the agency issues it.":
    "Marcado como enviado. Sube el documento oficial en cuanto la agencia lo emita.",
  "Needs refresh — shared data changed": "Necesita actualizarse — los datos compartidos cambiaron",
  "None prepared": "Ninguno preparado",
  "PDF": "PDF",
  "Please check these answers": "Por favor revisa estas respuestas",
  "Preparation worksheet": "Hoja de trabajo de preparación",
  "Prepare another": "Preparar otro",
  "Prepared": "Preparado",
  "Prepared Application Worksheets": "Hojas de Trabajo de Solicitud Preparadas",
  "Preview PDF Report": "Vista Previa del Informe PDF",
  "Readiness Report": "Informe de Preparación",
  "Renew and upload current agency-issued evidence.": "Renueva y sube evidencia vigente emitida por la agencia.",
  "Required field": "Campo requerido",
  "Return to the checklist and choose Prepare application.": "Vuelve a la lista y elige Preparar solicitud.",
  "Review document": "Revisar documento",
  "Review now": "Revisar ahora",
  "Review submission": "Revisar envío",
  "Review updates": "Revisar actualizaciones",
  "Save draft": "Guardar borrador",
  "Select an option": "Selecciona una opción",
  "The expiration date extracted from this document has passed.": "La fecha de vencimiento extraída de este documento ya pasó.",
  "The requirement remains incomplete until you upload:": "El requisito permanece incompleto hasta que subas:",
  "This is a sample preparation worksheet, not an official filing.": "Esta es una hoja de trabajo de ejemplo, no una radicación oficial.",
  "This is the exact PDF that will be added to your deliverables — nothing is saved until you confirm below.":
    "Este es el PDF exacto que se agregará a tus entregables — nada se guarda hasta que confirmes abajo.",
  "View": "Ver",
  "Complete LUMA form": "Completa el formulario de LUMA",
  "Already have the signed attestation?": "¿Ya tienes la confirmación firmada?",
  "Upload signed attestation": "Sube la confirmación firmada",
  "Waiting for confirmation": "Esperando confirmación",
  "Your business name": "El nombre de tu negocio",
  "expired": "vencido",
  "files": "archivos",
  "required fields are missing.": "faltan campos requeridos.",
};

export function L(text: string | undefined | null, lang: Lang): string {
  const s = (text ?? "").toString();
  if (lang !== "es") return s;
  return ES[s] ?? s;
}
