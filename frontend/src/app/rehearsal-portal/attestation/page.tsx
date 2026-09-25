"use client";

import { useRouter } from "next/navigation";
import {
  CheckRow,
  PageSub,
  PageTitle,
  PortalCard,
  PrimaryButton,
  TextInput,
  useRehearsal,
} from "../rehearsal";

/** Attestation — legal certification + signature. Agent must PAUSE for human review. */
export default function RehearsalAttestationPage() {
  const { t, data, setField } = useRehearsal();
  const router = useRouter();
  const certified = data.attestCertified === "yes";
  const signed = (data.attestSignature ?? "").trim().length > 0;

  return (
    <PortalCard step="certification">
      <PageTitle>{t("Certification (rehearsal)", "Certificación (ensayo)")}</PageTitle>
      <PageSub>
        {t(
          "Read carefully — a human must review and sign. This step always requires a person.",
          "Lee con cuidado — una persona debe revisar y firmar. Este paso siempre requiere a una persona."
        )}
      </PageSub>
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (certified && signed) router.push("/rehearsal-portal/payment");
        }}
      >
        <CheckRow
          id="attest-cert"
          name="attestCertified"
          label={t(
            "I certify under penalty of perjury that the information in this filing is true and correct.",
            "Certifico bajo pena de perjurio que la información en esta radicación es verdadera y correcta."
          )}
          checked={certified}
          onChange={(v) => setField("attestCertified", v ? "yes" : "")}
        />
        <TextInput
          id="attest-signature"
          name="signature"
          label={t("Signature (printed name)", "Firma (nombre en letra de molde)")}
          value={data.attestSignature ?? ""}
          onChange={(v) => setField("attestSignature", v)}
          required
          autoComplete="name"
        />
        <PrimaryButton disabled={!certified || !signed}>
          {t("Continue to payment", "Continuar al pago")}
        </PrimaryButton>
      </form>
    </PortalCard>
  );
}
