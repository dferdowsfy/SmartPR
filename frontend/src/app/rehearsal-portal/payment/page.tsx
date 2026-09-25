"use client";

import { useRouter } from "next/navigation";
import {
  PageSub,
  PageTitle,
  PortalCard,
  PrimaryButton,
  TextInput,
  useRehearsal,
} from "../rehearsal";

/** Payment — fake card form. Agent must PAUSE; never enter card details or pay. */
export default function RehearsalPaymentPage() {
  const { t, data, setField } = useRehearsal();
  const router = useRouter();

  return (
    <PortalCard step="payment">
      <PageTitle>{t("Payment (rehearsal — no real charge)", "Pago (ensayo — no se cobra nada real)")}</PageTitle>
      <PageSub>
        {t(
          "Amount due: $25.00 (demo). A human must review and approve — never enter real card details.",
          "Cantidad a pagar: $25.00 (demo). Una persona debe revisar y aprobar — nunca ingreses datos reales de tarjeta."
        )}
      </PageSub>
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          router.push("/rehearsal-portal/review");
        }}
      >
        <TextInput
          id="pay-card"
          name="cardNumber"
          label={t("Card number", "Número de tarjeta")}
          value={data.cardNumber ?? ""}
          onChange={(v) => setField("cardNumber", v)}
          required
          autoComplete="cc-number"
          inputMode="numeric"
          placeholder="4111 1111 1111 1111"
          hint={t("Demo only — use the placeholder, never a real card.", "Solo demo — usa el ejemplo, nunca una tarjeta real.")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            id="pay-exp"
            name="cardExp"
            label={t("Expiration (MM/YY)", "Vencimiento (MM/AA)")}
            value={data.cardExp ?? ""}
            onChange={(v) => setField("cardExp", v)}
            required
            autoComplete="cc-exp"
            placeholder="12/28"
          />
          <TextInput
            id="pay-cvc"
            name="cardCvc"
            label="CVC"
            value={data.cardCvc ?? ""}
            onChange={(v) => setField("cardCvc", v)}
            required
            autoComplete="cc-csc"
            inputMode="numeric"
            placeholder="123"
          />
        </div>
        <PrimaryButton>{t("Pay $25.00 (demo)", "Pagar $25.00 (demo)")}</PrimaryButton>
      </form>
    </PortalCard>
  );
}
