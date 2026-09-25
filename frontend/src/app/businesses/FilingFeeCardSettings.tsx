"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Lang } from "../forms/engine/types";
import {
  cardDisplayName,
  cardExpiryLabel,
  type FilingFeeCardPublic,
} from "../../lib/billing/filingFeeCard";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

type State =
  | { status: "loading" }
  | { status: "ready"; card: FilingFeeCardPublic | null }
  | { status: "unavailable" };

/** The business's filing-fee card reminder (display details only). */
export function useFilingFeeCard(businessId: string | null | undefined) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    fetch(`/api/businesses/${encodeURIComponent(businessId)}/payment-settings`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as { filingFeeCard?: FilingFeeCardPublic | null };
        if (!cancelled) setState({ status: "ready", card: data.filingFeeCard ?? null });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, reloadKey]);

  const remove = useCallback(async () => {
    if (!businessId) return false;
    const r = await fetch(`/api/businesses/${encodeURIComponent(businessId)}/payment-settings`, { method: "DELETE" });
    if (r.ok) setState({ status: "ready", card: null });
    return r.ok;
  }, [businessId]);

  return { state, remove, reload: () => setReloadKey((k) => k + 1) };
}

export function saveCardHref(businessId: string): string {
  return `/pricing?saveCard=1&business=${encodeURIComponent(businessId)}`;
}

/** Business Passport → Payment settings. */
export function FilingFeeCardSettings({ businessId, lang }: { businessId: string; lang: Lang }) {
  const { state, remove } = useFilingFeeCard(businessId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (state.status === "unavailable") return null;
  const card = state.status === "ready" ? state.card : null;
  const expiry = card ? cardExpiryLabel(card) : null;

  return (
    <div className="mt-4 rounded-xl border border-slate-200 px-4 py-3" data-testid="passport-payment-settings">
      <div className="text-sm font-bold text-[#161616]">{L("Payment settings", "Configuración de pago", lang)}</div>
      {state.status === "loading" ? (
        <p className="mt-1 text-xs text-slate-500">{L("Loading…", "Cargando…", lang)}</p>
      ) : card ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-medium text-slate-500">
              {L("Card for government filing fees", "Tarjeta para cargos de radicación", lang)}
            </div>
            <div className="text-sm font-semibold text-[#161616]" data-testid="filing-fee-card-name">
              {cardDisplayName(card)}
              {expiry && (
                <span className={`ml-2 text-xs font-medium ${card.expired ? "text-rose-700" : "text-slate-500"}`}>
                  {card.expired ? L(`Expired ${expiry}`, `Venció ${expiry}`, lang) : L(`Exp. ${expiry}`, `Vence ${expiry}`, lang)}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const ok = await remove();
              if (!ok) setError(L("Couldn't remove the card. Try again.", "No se pudo quitar la tarjeta. Inténtalo de nuevo.", lang));
              setBusy(false);
            }}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
          >
            {L("Remove", "Quitar", lang)}
          </button>
        </div>
      ) : (
        <p className="mt-1 text-xs text-slate-600">
          {L("No card saved for filing fees. ", "No hay tarjeta guardada para cargos de radicación. ", lang)}
          <Link href={saveCardHref(businessId)} className="font-semibold text-brand hover:underline">
            {L("Save one at checkout", "Guárdala al pagar", lang)}
          </Link>
        </p>
      )}
      <p className="mt-2 text-[11px] text-slate-500">
        {L(
          "A reminder only: Mita shows this card at an agency's payment step and you enter it in the agency portal yourself. SmartPR keeps only the brand and last 4 digits and never charges it for government fees. Removing it here doesn't change your SmartPR subscription.",
          "Solo un recordatorio: Mita muestra esta tarjeta en el paso de pago de la agencia y tú la escribes en el portal. SmartPR solo guarda la marca y los últimos 4 dígitos y nunca la cobra por cargos del gobierno. Quitarla aquí no cambia tu suscripción de SmartPR.",
          lang
        )}
      </p>
      {error && <p className="mt-1 text-xs font-medium text-rose-700">{error}</p>}
    </div>
  );
}
