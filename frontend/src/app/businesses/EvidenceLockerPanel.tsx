"use client";

// Evidence locker panel — business-scoped upload-once store with requirement tags.
// Reuses the existing evidence API / storage bucket.

import { useMemo, useRef, useState } from "react";
import { Archive, FileText, Tag, Upload } from "lucide-react";
import { normalizeRequirementTags } from "../compliance/evidenceLocker";
import type { Lang } from "../forms/engine/types";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

export interface LockerFileRow {
  id: string;
  original_filename: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  document_type?: string | null;
  review_status?: string | null;
  obligation_id?: string | null;
  requirement_tags?: string[] | null;
  created_at?: string | null;
  obligation_name?: string | null;
}

export interface LockerObligationOption {
  id: string;
  name: string;
  requirement_id?: string | null;
}

export interface EvidenceLockerPanelProps {
  businessId: string;
  files: LockerFileRow[];
  obligations: LockerObligationOption[];
  lang: Lang;
  onChanged: () => void;
}

function fmtSize(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EvidenceLockerPanel({
  businessId,
  files,
  obligations,
  lang,
  onChanged,
}: EvidenceLockerPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTags, setEditTags] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [packBusy, setPackBusy] = useState(false);

  const suggestionCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const o of obligations) {
      if (o.requirement_id) codes.add(o.requirement_id);
    }
    return Array.from(codes).sort();
  }, [obligations]);

  const upload = async (file: File) => {
    setUploading(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("business_id", businessId);
      const tags = normalizeRequirementTags(tagDraft);
      for (const tag of tags) form.append("requirement_tags[]", tag);
      const response = await fetch("/api/evidence", { method: "POST", body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(result.error || L("Could not upload.", "No se pudo subir.", lang));
        return;
      }
      setTagDraft("");
      onChanged();
    } finally {
      setUploading(false);
    }
  };

  const saveTags = async (id: string) => {
    setBusyId(id);
    setMessage(null);
    try {
      const response = await fetch(`/api/evidence/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirement_tags: normalizeRequirementTags(editTags) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(result.error || L("Could not save tags.", "No se pudieron guardar las etiquetas.", lang));
        return;
      }
      setEditingId(null);
      onChanged();
    } finally {
      setBusyId(null);
    }
  };

  const downloadPackage = async () => {
    setPackBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/businesses/${businessId}/evidence-package`, { method: "POST" });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        setMessage(result.error || L("Could not build package.", "No se pudo armar el paquete.", lang));
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `smartpr-evidence-${businessId}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setPackBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/[0.02]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50">
            <Archive className="h-4 w-4 text-indigo-700" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-bold text-[#161616]">
                {L("Evidence locker", "Casillero de evidencia", lang)}
              </h2>
              <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-bold text-indigo-800">
                {files.length === 1
                  ? L("1 file", "1 archivo", lang)
                  : L(`${files.length} files`, `${files.length} archivos`, lang)}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              {L(
                "Upload once, tag the requirements a file satisfies, and reuse it across agency asks instead of re-uploading.",
                "Suba una vez, etiquete los requisitos que satisface el archivo y reutilícelo en cada solicitud de agencia sin volver a subirlo.",
                lang
              )}
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={packBusy || files.length === 0}
          onClick={() => void downloadPackage()}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40"
        >
          <Archive className="h-3.5 w-3.5" />
          {packBusy
            ? L("Building ZIP…", "Armando ZIP…", lang)
            : L("Download evidence ZIP", "Descargar ZIP de evidencia", lang)}
        </button>
      </div>

      {/* Inventory-first: stored files as clear cards */}
      <div className="mt-4 space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
          {L("Stored files", "Archivos guardados", lang)}
        </h3>
        {files.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 py-8 text-center text-sm text-slate-400">
            {L("No locker files yet. Upload below to start your inventory.", "Aún no hay archivos en el casillero. Suba abajo para comenzar su inventario.", lang)}
          </div>
        ) : (
          files.map((file) => {
            const tags = file.requirement_tags ?? [];
            const editing = editingId === file.id;
            return (
              <div key={file.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm shadow-slate-950/[0.02]">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex items-start gap-2">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                      <FileText className="h-4 w-4 text-slate-600" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-[#161616]" title={file.original_filename}>
                        {file.original_filename}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {[fmtSize(file.size_bytes), file.mime_type, file.review_status]
                          .filter(Boolean)
                          .join(" · ")}
                        {file.obligation_name ? ` · ${file.obligation_name}` : ""}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(editing ? null : file.id);
                      setEditTags(tags.join(", "));
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-600"
                  >
                    <Tag className="h-3 w-3" />
                    {editing ? L("Cancel", "Cancelar", lang) : L("Edit tags", "Editar etiquetas", lang)}
                  </button>
                </div>
                {!editing && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {tags.length === 0 ? (
                      <span className="text-[11px] text-slate-400">
                        {L("No requirement tags yet.", "Sin etiquetas de requisito.", lang)}
                      </span>
                    ) : (
                      tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold tracking-wide text-indigo-800"
                        >
                          {tag}
                        </span>
                      ))
                    )}
                  </div>
                )}
                {editing && (
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      value={editTags}
                      onChange={(e) => setEditTags(e.target.value)}
                      list="locker-tag-suggestions"
                      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                      placeholder="DOC_BOND, DOC_ID"
                    />
                    <button
                      type="button"
                      disabled={busyId === file.id}
                      onClick={() => void saveTags(file.id)}
                      className="rounded-lg bg-[#161616] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {L("Save tags", "Guardar etiquetas", lang)}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Upload zone — secondary but clear */}
      <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4">
        <div className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
          {L("Add to locker", "Agregar al casillero", lang)}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 text-xs font-semibold text-slate-600">
            {L("Tags for next upload (requirement codes)", "Etiquetas del próximo archivo (códigos de requisito)", lang)}
            <input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              placeholder="DOC_CONTRACTOR_LICENSE, DOC_BOND"
              list="locker-tag-suggestions"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-[#161616]"
            />
            <datalist id="locker-tag-suggestions">
              {suggestionCodes.map((code) => (
                <option key={code} value={code} />
              ))}
            </datalist>
          </label>
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            {uploading ? L("Uploading…", "Subiendo…", lang) : L("Upload to locker", "Subir al casillero", lang)}
          </button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,.doc,.docx,.xls,.xlsx"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void upload(file);
            }}
          />
        </div>
      </div>

      {message && <p className="mt-3 text-xs text-red-600">{message}</p>}
    </section>
  );
}

/** Compact picker used on requirement cards to attach an existing locker file. */
export function AttachFromLockerPicker({
  lang,
  lockerFiles,
  requirementId,
  obligationId,
  busy,
  onAttach,
}: {
  lang: Lang;
  lockerFiles: LockerFileRow[];
  requirementId?: string | null;
  obligationId: string;
  busy?: boolean;
  onAttach: (evidenceId: string) => void;
}) {
  const candidates = useMemo(() => {
    const code = (requirementId || "").toUpperCase();
    return lockerFiles.filter((f) => {
      if (f.obligation_id === obligationId) return false; // already linked as primary
      const tags = (f.requirement_tags || []).map((t) => t.toUpperCase());
      if (code && tags.includes(code)) return true;
      // Always offer untagged / other files so user can reuse any locker doc
      return true;
    });
  }, [lockerFiles, obligationId, requirementId]);

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");

  if (candidates.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-indigo-300 px-3 py-1 text-xs font-semibold text-indigo-700 disabled:opacity-50"
      >
        <Archive className="h-3.5 w-3.5" />
        {L("Attach from locker", "Adjuntar del casillero", lang)}
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          <div className="text-xs font-semibold text-slate-600">
            {L("Choose a locker file", "Elija un archivo del casillero", lang)}
          </div>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
          >
            <option value="">{L("Select…", "Seleccionar…", lang)}</option>
            {candidates.map((f) => (
              <option key={f.id} value={f.id}>
                {f.original_filename}
                {(f.requirement_tags || []).length ? ` [${(f.requirement_tags || []).join(", ")}]` : ""}
              </option>
            ))}
          </select>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600"
            >
              {L("Cancel", "Cancelar", lang)}
            </button>
            <button
              type="button"
              disabled={!selected || busy}
              onClick={() => {
                onAttach(selected);
                setOpen(false);
                setSelected("");
              }}
              className="rounded-lg bg-indigo-700 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40"
            >
              {L("Attach", "Adjuntar", lang)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
