"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, Check, X } from "lucide-react";

interface Reminder {
  id: string;
  type: string;
  message: string;
  scheduled_for: string;
  status: string;
  business_id: string;
  obligation_id: string | null;
  business_name: string;
}

function reminderDateLabel(scheduledFor: string): string {
  const target = new Date(scheduledFor).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.ceil((target - today.getTime()) / 86400000);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export function NotificationBell() {
  const [reminders, setReminders] = useState<Reminder[] | null>(null);
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/portfolio");
      const data = await response.json();
      setReminders(Array.isArray(data.notifications) ? data.notifications : []);
    } catch {
      setReminders([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!open) return;
    void load();
    const timer = window.setInterval(load, 60000);
    return () => window.clearInterval(timer);
  }, [open, load]);

  const placePanel = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setPanelPos({ top: Math.round(r.bottom + 10), right: Math.round(window.innerWidth - r.right) });
  }, []);

  useLayoutEffect(() => {
    if (!open) { setPanelPos(null); return; }
    placePanel();
    const onReposition = () => placePanel();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, placePanel]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (btnRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", onPointerDown);
      document.addEventListener("touchstart", onPointerDown);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open ]);

  async function act(id: string, action: "read" | "dismiss") {
    setReminders((prev) => (prev ?? []).filter((r) => r.id !== id));
    try {
      await fetch(`/api/notifications/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
    } catch {
      void load();
    }
  }

  const count = reminders?.length ?? 0;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={count > 0 ? `${count} reminders` : "No reminders"}
        aria-expanded={open}
        title="Reminders"
        className="relative rounded-full p-2 text-slate-600 transition hover:bg-slate-100 hover:text-[#161616]"
      >
        <Bell size={19} />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white tabular-nums">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>
      {open && panelPos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              role="menu"
              aria-label="Reminders"
              className="z-[100] w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
              style={{ position: "fixed", top: panelPos.top, right: panelPos.right }}
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <div className="text-sm font-bold text-[#161616]">Reminders</div>
                <Link href="/calendar" onClick={() => setOpen(false)} className="text-xs font-semibold text-[#245c5c] hover:underline">
                  View calendar
                </Link>
              </div>
              {reminders === null ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500">Loading reminders…</div>
              ) : reminders.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Bell className="mx-auto mb-2 h-7 w-7 text-slate-300" />
                  <div className="text-sm font-semibold text-[#161616]">You&apos;re all caught up.</div>
                  <p className="mt-1 text-xs text-slate-500">SmartPR reminds you 90, 60, 30 and 7 days before a filing is due.</p>
                </div>
              ) : (
                <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
                  {reminders.map((reminder) => (
                    <li key={reminder.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold leading-snug text-[#161616]">{reminder.message}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {reminder.business_name} · {reminderDateLabel(reminder.scheduled_for)}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            onClick={() => act(reminder.id, "read")}
                            title="Mark as read"
                            aria-label="Mark as read"
                            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-[#245c5c]"
                          >
                            <Check size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => act(reminder.id, "dismiss")}
                            title="Dismiss"
                            aria-label="Dismiss"
                            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-700"
                          >
                            <X size={15} />
                          </button>
                        </div>
                      </div>
                      {reminder.obligation_id && (
                        <Link
                          href={`/businesses/${reminder.business_id}#obligation-${reminder.obligation_id}`}
                          onClick={() => setOpen(false)}
                          className="mt-1 inline-block text-xs font-semibold text-[#245c5c] hover:underline"
                        >
                          Open filing →
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
