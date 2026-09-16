# Rules changed in audit 2026-09-16

Total rules changed: 232 | new rules added: 3 (RULE_0647-0649) | rules removed: 0

## RULE_0003
- Document: Merchant Registration Certificate (Registro de Comerciante)
- Trigger: ANY municipality selected
- Change: compliance_mode set to verify_existing (was implicit new_application)
- Reason: Audit 2026-09-16: a universal municipality trigger must not present existing-business compliance as a new filing. New businesses still see REQUIRED; existing businesses see VERIFY_EXISTING.
- Regulatory basis: PR businesses conducting commercial activity register with Hacienda (SURI); an already-operating business verifies its existing registration covers this location/activity instead of filing anew.

## RULE_0004
- Document: Patente Municipal
- Trigger: ANY municipality selected
- Change: compliance_mode set to verify_existing (was implicit new_application)
- Reason: Audit 2026-09-16: a universal municipality trigger must not present existing-business compliance as a new filing. New businesses still see REQUIRED; existing businesses see VERIFY_EXISTING.
- Regulatory basis: Municipal gross-receipts license (patente) is a per-municipality obligation; an operating business verifies its current patente rather than applying as if new.

## RULE_0005
- Document: Municipal Registration
- Trigger: ANY municipality selected
- Change: compliance_mode set to verify_existing (was implicit new_application)
- Reason: Audit 2026-09-16: a universal municipality trigger must not present existing-business compliance as a new filing. New businesses still see REQUIRED; existing businesses see VERIFY_EXISTING.
- Regulatory basis: Municipality-specific business registration; existing businesses verify current registration status.

## RULE_0006
- Document: Municipal Tax Compliance Certificate
- Trigger: ANY municipality selected
- Change: compliance_mode set to verify_existing (was implicit new_application)
- Reason: Audit 2026-09-16: a universal municipality trigger must not present existing-business compliance as a new filing. New businesses still see REQUIRED; existing businesses see VERIFY_EXISTING.
- Regulatory basis: Evidence of municipal tax standing; an operating business verifies rather than re-establishing.

## RULE_0037
- Document: Lease Agreement
- Trigger: Q_EXISTING_LEASE=true
- Change: compliance_mode set to supporting_evidence
- Reason: Audit 2026-09-16: lease is evidence of tenure, never a standalone requirement. Tenure unknown -> ask, never assume.
- Regulatory basis: A lease agreement proves site control/tenure as evidence for another filing; it is not an independent regulatory requirement.

## RULE_0265
- Document: Environmental Permit
- Trigger: flag=coastal + business_type=Excursion Company
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Excursion Company in a coastal municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0266
- Document: Environmental Permit
- Trigger: flag=coastal + business_type=Tour Operator
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Tour Operator in a coastal municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0267
- Document: Zoning / Use Certification
- Trigger: flag=historic (no business type)
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: bare municipality-flag triggers are not regulatory triggers. Rule kept as needs-evaluation guidance, never a confirmed requirement.
- Regulatory basis: Zoning/use certification in historic zones needs confirmation the property is actually in a designated historic district.

## RULE_0269
- Document: Stormwater Management Plan (NPDES MS4)
- Trigger: flag=metro (no business type)
- Change: verification set to heuristic with missing_fact_keys and negated_fact_keys
- Reason: Audit 2026-09-16: bare municipality-flag triggers are not regulatory triggers. Rule kept as needs-evaluation guidance, never a confirmed requirement.
- Regulatory basis: NPDES construction stormwater coverage is driven by land disturbance (EPA CGP threshold is 1 acre, incl. smaller sites in a common plan), not by metro location or interior floor area. 12,000 sq ft of renovated interior space is not 12,000 sq ft of disturbed land.

## RULE_0270
- Document: Commercial Solid Waste Collection Contract
- Trigger: flag=metro (no business type)
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: bare municipality-flag triggers are not regulatory triggers. Rule kept as needs-evaluation guidance, never a confirmed requirement.
- Regulatory basis: Commercial solid-waste collection depends on the use generating regulated waste and municipal ordinance, not on metro location alone.

## RULE_0271
- Document: Off-Street Parking Compliance Certificate
- Trigger: flag=metro (no business type)
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: bare municipality-flag triggers are not regulatory triggers. Rule kept as needs-evaluation guidance, never a confirmed requirement.
- Regulatory basis: Off-street parking compliance depends on use, occupancy, floor area and municipal parking ordinances — not on metro location alone.

## RULE_0272
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Restaurant
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Restaurant in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0273
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Fast Food Restaurant
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Fast Food Restaurant in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0274
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Fast Food Restaurant
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Fast Food Restaurant in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0275
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Bar
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Bar in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0276
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Music Venue
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Music Venue in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0277
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Event Venue
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Event Venue in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0278
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Hotel
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Hotel in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0279
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Hotel
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Hotel in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0280
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Hardware Store
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Hardware Store in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0281
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Furniture Store
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Furniture Store in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0282
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Electronics Store
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Electronics Store in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0283
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Convenience Store
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Convenience Store in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0284
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Gym / Fitness Studio
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Gym / Fitness Studio in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0285
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Food Truck
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Food Truck in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0286
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Food Truck
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Food Truck in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0287
- Document: San Juan Municipal Use Permit (Permiso Municipal de Uso)
- Trigger: flag=capital (no business type)
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: bare municipality-flag triggers are not regulatory triggers. Rule kept as needs-evaluation guidance, never a confirmed requirement.
- Regulatory basis: San Juan (autonomous municipality) use-permit rules are jurisdiction-specific; a blanket capital-flag trigger is unverified against the municipal ordinance.

## RULE_0294
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=capital + business_type=Restaurant
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Restaurant in a capital municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0295
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=capital + business_type=Bar
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Bar in a capital municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0296
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=capital + business_type=Cafe
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Cafe in a capital municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0297
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=capital + business_type=Convenience Store
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Convenience Store in a capital municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0298
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=capital + business_type=Hotel
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Hotel in a capital municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0299
- Document: Historic Facade Preservation Plan
- Trigger: flag=historic (no business type)
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: bare municipality-flag triggers are not regulatory triggers. Rule kept as needs-evaluation guidance, never a confirmed requirement.
- Regulatory basis: Facade preservation review needs confirmation of historic designation and exterior scope.

## RULE_0300
- Document: Stormwater Management Plan (NPDES MS4)
- Trigger: flag=coastal + business_type=Restaurant
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Restaurant in a coastal municipality is often subject to municipal stormwater management plan review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0304
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Plant Nursery
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Plant Nursery in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0305
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Aquaculture Operation
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Aquaculture Operation in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0306
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Agricultural Services Company
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Agricultural Services Company in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0307
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Agricultural Services Company
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Agricultural Services Company in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0308
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Art Gallery
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Art Gallery in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0309
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Dance Studio
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Dance Studio in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0310
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Dance Studio
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Dance Studio in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0311
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Sports Facility
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Sports Facility in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0312
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Sports Facility
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Sports Facility in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0313
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Theater
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Theater in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0314
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Theater
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Theater in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0315
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Auto Parts Store
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Auto Parts Store in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0316
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Auto Parts Store
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Auto Parts Store in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0317
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Auto Parts Store
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Auto Parts Store in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0318
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Auto Repair Shop
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Auto Repair Shop in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0319
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Auto Repair Shop
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Auto Repair Shop in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0320
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Auto Repair Shop
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Auto Repair Shop in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0321
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Auto Repair Shop
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Auto Repair Shop in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0322
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Body Shop
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Body Shop in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0323
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Body Shop
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Body Shop in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0324
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Body Shop
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Body Shop in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0325
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Body Shop
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Body Shop in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0326
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Car Dealership
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Car Dealership in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0327
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Car Dealership
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Car Dealership in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0328
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Car Dealership
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Car Dealership in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0329
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Car Wash
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Car Wash in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0330
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Car Wash
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Car Wash in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0331
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Car Wash
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Car Wash in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0332
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Motorcycle Repair Shop
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Motorcycle Repair Shop in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0333
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Motorcycle Repair Shop
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Motorcycle Repair Shop in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0334
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Tire Shop
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Tire Shop in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0335
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Tire Shop
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Tire Shop in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0336
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Barbershop
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Barbershop in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0337
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Beauty Salon
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Beauty Salon in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0338
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Esthetics Studio
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Esthetics Studio in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0339
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Massage Therapy Studio
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Massage Therapy Studio in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0340
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Nail Salon
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Nail Salon in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0341
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Nail Salon
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Nail Salon in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0342
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Spa
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Spa in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0343
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Tattoo Shop
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Tattoo Shop in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0344
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Tattoo Shop
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Tattoo Shop in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0345
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=General Contractor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: General Contractor in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0346
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=General Contractor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: General Contractor in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0347
- Document: Environmental Permit
- Trigger: flag=metro + business_type=General Contractor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: General Contractor in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0348
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Concrete Contractor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Concrete Contractor in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0349
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Concrete Contractor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Concrete Contractor in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0350
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Concrete Contractor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Concrete Contractor in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0351
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Electrical Contractor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Electrical Contractor in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0352
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=HVAC Contractor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: HVAC Contractor in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0353
- Document: Environmental Permit
- Trigger: flag=metro + business_type=HVAC Contractor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: HVAC Contractor in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0354
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Plumbing Contractor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Plumbing Contractor in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0355
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Roofing Contractor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Roofing Contractor in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0356
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Roofing Contractor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Roofing Contractor in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0357
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Roofing Contractor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Roofing Contractor in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0358
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Landscaping Company
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Landscaping Company in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0359
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Landscaping Company
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Landscaping Company in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0360
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Landscaping Company
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Landscaping Company in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0361
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Specialty Trade Contractor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Specialty Trade Contractor in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0362
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=After-School Program
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: After-School Program in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0363
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Daycare
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Daycare in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0364
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Private School
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Private School in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0365
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Private School
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Private School in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0366
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Private School
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Private School in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0367
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Vocational School
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Vocational School in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0368
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Vocational School
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Vocational School in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0369
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Vocational School
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Vocational School in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0370
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Battery Storage Installer
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Battery Storage Installer in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0371
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Battery Storage Installer
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Battery Storage Installer in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0372
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Renewable Energy Company
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Renewable Energy Company in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0373
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Solar Installer
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Solar Installer in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0374
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Utility Contractor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Utility Contractor in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0375
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Utility Contractor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Utility Contractor in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0376
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Utility Contractor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Utility Contractor in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0377
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Bakery
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Bakery in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0378
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Bakery
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Bakery in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0379
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Catering Business
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Catering Business in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0380
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Catering Business
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Catering Business in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0381
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Commercial Kitchen
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Commercial Kitchen in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0382
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Commercial Kitchen
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Commercial Kitchen in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0383
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Commercial Kitchen
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Commercial Kitchen in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0384
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Ice Cream Shop
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Ice Cream Shop in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0385
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Ice Cream Shop
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Ice Cream Shop in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0386
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Juice Bar
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Juice Bar in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0387
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Security Contractor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Security Contractor in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0388
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Clinical Laboratory
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Clinical Laboratory in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0389
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Clinical Laboratory
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Clinical Laboratory in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0390
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Clinical Laboratory
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Clinical Laboratory in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0391
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Dental Office
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Dental Office in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0392
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Dental Office
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Dental Office in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0393
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Medical Office
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Medical Office in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0394
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Medical Office
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Medical Office in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0395
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Medical Spa
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Medical Spa in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0396
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Medical Spa
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Medical Spa in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0397
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Mental Health Practice
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Mental Health Practice in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0398
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Pharmacy
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Pharmacy in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0399
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Pharmacy
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Pharmacy in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0400
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Pharmacy
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Pharmacy in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0401
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Physical Therapy Clinic
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Physical Therapy Clinic in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0402
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Urgent Care Center
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Urgent Care Center in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0403
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Urgent Care Center
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Urgent Care Center in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0404
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Urgent Care Center
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Urgent Care Center in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0405
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Veterinary Clinic
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Veterinary Clinic in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0406
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Veterinary Clinic
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Veterinary Clinic in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0407
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Beverage Manufacturing
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Beverage Manufacturing in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0408
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Beverage Manufacturing
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Beverage Manufacturing in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0409
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Beverage Manufacturing
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Beverage Manufacturing in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0410
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Chemical Manufacturing
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Chemical Manufacturing in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0411
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Chemical Manufacturing
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Chemical Manufacturing in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0412
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Chemical Manufacturing
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Chemical Manufacturing in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0413
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Food Manufacturing
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Food Manufacturing in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0414
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Food Manufacturing
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Food Manufacturing in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0415
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Food Manufacturing
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Food Manufacturing in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0416
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Furniture Manufacturing
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Furniture Manufacturing in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0417
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Furniture Manufacturing
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Furniture Manufacturing in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0418
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Furniture Manufacturing
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Furniture Manufacturing in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0419
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Medical Device Manufacturing
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Medical Device Manufacturing in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0420
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Medical Device Manufacturing
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Medical Device Manufacturing in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0421
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Pharmaceutical Manufacturing
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Pharmaceutical Manufacturing in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0422
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Pharmaceutical Manufacturing
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Pharmaceutical Manufacturing in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0423
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Textile Manufacturing
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Textile Manufacturing in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0424
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Textile Manufacturing
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Textile Manufacturing in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0425
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Textile Manufacturing
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Textile Manufacturing in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0426
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Religious Organization
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Religious Organization in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0427
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Religious Organization
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Religious Organization in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0428
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Property Management Company
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Property Management Company in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0429
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Property Management Company
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Property Management Company in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0430
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Real Estate Brokerage
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Real Estate Brokerage in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0431
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Real Estate Developer
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Real Estate Developer in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0432
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Real Estate Developer
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Real Estate Developer in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0433
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Real Estate Developer
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Real Estate Developer in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0434
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Clothing Store
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Clothing Store in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0435
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Clothing Store
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Clothing Store in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0436
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Cosmetics Store
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Cosmetics Store in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0437
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Cosmetics Store
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Cosmetics Store in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0438
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Gift Shop
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Gift Shop in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0439
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Jewelry Store
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Jewelry Store in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0440
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Pet Store
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Pet Store in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0441
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Pet Store
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Pet Store in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0442
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Car Rental Business
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Car Rental Business in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0443
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Car Rental Business
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Car Rental Business in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0444
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Car Rental Business
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Car Rental Business in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0445
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Excursion Company
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Excursion Company in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0446
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Excursion Company
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Excursion Company in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0447
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Guest House
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Guest House in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0448
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Guest House
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Guest House in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0449
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Resort
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Resort in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0450
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Resort
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Resort in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0451
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Resort
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Resort in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0452
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Tour Operator
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Tour Operator in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0453
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Tour Operator
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Tour Operator in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0454
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Travel Agency
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Travel Agency in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0455
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Courier Service
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Courier Service in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0456
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Courier Service
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Courier Service in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0457
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Freight Forwarding Company
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Freight Forwarding Company in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0458
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Freight Forwarding Company
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Freight Forwarding Company in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0459
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Freight Forwarding Company
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Freight Forwarding Company in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0460
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Logistics Company
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Logistics Company in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0461
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Logistics Company
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Logistics Company in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0462
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Moving Company
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Moving Company in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0463
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Moving Company
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Moving Company in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0464
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Taxi Service
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Taxi Service in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0465
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Taxi Service
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Taxi Service in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0466
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Trucking Company
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Trucking Company in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0467
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Trucking Company
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Trucking Company in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0468
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Trucking Company
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Trucking Company in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0469
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Warehouse Operator
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Warehouse Operator in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0470
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Warehouse Operator
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Warehouse Operator in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0471
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Beverage Distributor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Beverage Distributor in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0472
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Beverage Distributor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Beverage Distributor in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0473
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Import / Export Business
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Import / Export Business in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0474
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Warehouse Distributor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Warehouse Distributor in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0475
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Warehouse Distributor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Warehouse Distributor in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0476
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Wholesale Food Distributor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Wholesale Food Distributor in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0477
- Document: Environmental Permit
- Trigger: flag=metro + business_type=Wholesale Food Distributor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Wholesale Food Distributor in a metro municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0478
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Wholesale Goods Distributor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Wholesale Goods Distributor in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0507
- Document: Commercial Solid Waste Collection Contract
- Trigger: flag=island (no business type)
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: bare municipality-flag triggers are not regulatory triggers. Rule kept as needs-evaluation guidance, never a confirmed requirement.
- Regulatory basis: Commercial solid-waste collection depends on the use and municipal ordinance, not on island location alone.

## RULE_0519
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Architecture Firm
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Architecture Firm in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0520
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Architecture Firm
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Architecture Firm in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0521
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Engineering Firm
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Engineering Firm in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0522
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Engineering Firm
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Engineering Firm in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0523
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Construction Government Contractor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Construction Government Contractor in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0524
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Construction Government Contractor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Construction Government Contractor in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0525
- Document: Noise Variance / Endoso de Ruido
- Trigger: flag=metro + business_type=Construction Government Contractor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Construction Government Contractor in a metro municipality is often subject to municipal noise variance review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0526
- Document: Commercial Loading / Unloading Zone Permit
- Trigger: flag=metro + business_type=Facilities Government Contractor
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Facilities Government Contractor in a metro municipality is often subject to municipal loading / unloading zone permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0527
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Training Company
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Training Company in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0528
- Document: Traffic Impact Study (Estudio de Impacto Vehicular)
- Trigger: flag=metro + business_type=Tutoring Center
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Tutoring Center in a metro municipality is often subject to municipal traffic impact study review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0551
- Document: Environmental Permit
- Trigger: flag=coastal + business_type=Hotel
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Hotel in a coastal municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0552
- Document: Environmental Permit
- Trigger: flag=coastal + business_type=Guest House
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Guest House in a coastal municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0553
- Document: Environmental Permit
- Trigger: flag=coastal + business_type=Resort
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Resort in a coastal municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0554
- Document: Environmental Permit
- Trigger: flag=coastal + business_type=Airbnb / Short-Term Rental
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Airbnb / Short-Term Rental in a coastal municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0555
- Document: Stormwater Management Plan (NPDES MS4)
- Trigger: flag=coastal + business_type=Bar
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Bar in a coastal municipality is often subject to municipal stormwater management plan review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0556
- Document: Stormwater Management Plan (NPDES MS4)
- Trigger: flag=coastal + business_type=Cafe
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Cafe in a coastal municipality is often subject to municipal stormwater management plan review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0557
- Document: Environmental Permit
- Trigger: flag=coastal + business_type=Convenience Store
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Convenience Store in a coastal municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0558
- Document: Environmental Permit
- Trigger: flag=coastal + business_type=Gift Shop
- Change: verification set to heuristic with missing_fact_keys
- Reason: Audit 2026-09-16: business-type + municipality-flag combinations are planning heuristics, not regulatory triggers.
- Regulatory basis: Heuristic planning association: Gift Shop in a coastal municipality is often subject to municipal environmental permit review, but the actual regulatory trigger is project-specific (use, scale, operations, site work) — not the business type or the flag. Unverified against the municipal ordinance: evaluate per project, never treat as a confirmed requirement.

## RULE_0636
- Document: Annual Report / Annual Fee (Informe Anual)
- Trigger: ANY municipality selected
- Change: compliance_mode set to verify_existing (was implicit new_application)
- Reason: Audit 2026-09-16: a universal municipality trigger must not present existing-business compliance as a new filing. New businesses still see REQUIRED; existing businesses see VERIFY_EXISTING.
- Regulatory basis: Recurring entity compliance (Dept. of State annual report / LLC fee); existing entities verify standing and due dates rather than filing an initial report.

## RULE_0647 (ADDED)
- Document: Stormwater Management Plan (NPDES MS4)
- Trigger: project fact land_disturbance_acres >=1
- Change: rule added
- Reason: Audit 2026-09-16: stormwater must trigger on land disturbance, replacing the metro-flag heuristic (RULE_0269) as the authoritative trigger.
- Regulatory basis: EPA Construction General Permit coverage applies at 1+ acres of land disturbance (smaller sites count when part of a larger common plan). Interior floor area is not land disturbance.

## RULE_0648 (ADDED)
- Document: Lease Agreement
- Trigger: project fact property_tenure leased
- Change: rule added
- Reason: Audit 2026-09-16: lease required only as tenure evidence when tenure is known-leased.
- Regulatory basis: When the property is leased, the lease agreement is supporting evidence of site control for the filing — not an independent requirement. Tenure unknown: ask, never assume.

## RULE_0649 (ADDED)
- Document: Property Deed (Escritura)
- Trigger: project fact property_tenure owned
- Change: rule added
- Reason: Audit 2026-09-16: ownership evidence replaces the lease when tenure is known-owned.
- Regulatory basis: When the property is owned, the deed (escritura) is supporting evidence of ownership for the filing — not an independent requirement.

