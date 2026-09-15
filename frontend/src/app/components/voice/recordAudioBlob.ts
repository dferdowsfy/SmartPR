/**
 * Robust MediaRecorder helpers for SmartPR voice orbs.
 * Uses a timeslice so chunks arrive during recording, and waits for the
 * final dataavailable event after stop() before assembling the Blob.
 */

export const MIN_AUDIO_BLOB_BYTES = 1024;

export type PreferredMime = {
  mimeType: string;
  filename: string;
};

/** Pick a browser-supported mime + matching filename for intake/passport voice STT. */
export function pickRecorderMime(): PreferredMime {
  if (typeof MediaRecorder === "undefined") {
    return { mimeType: "", filename: "audio.webm" };
  }
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
    return { mimeType: "audio/webm;codecs=opus", filename: "audio.webm" };
  }
  if (MediaRecorder.isTypeSupported("audio/webm")) {
    return { mimeType: "audio/webm", filename: "audio.webm" };
  }
  if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) {
    return { mimeType: "audio/ogg;codecs=opus", filename: "audio.ogg" };
  }
  if (MediaRecorder.isTypeSupported("audio/ogg")) {
    return { mimeType: "audio/ogg", filename: "audio.ogg" };
  }
  if (MediaRecorder.isTypeSupported("audio/mp4")) {
    return { mimeType: "audio/mp4", filename: "audio.m4a" };
  }
  return { mimeType: "", filename: "audio.webm" };
}

export function filenameForMime(mimeType: string): string {
  const t = (mimeType || "").toLowerCase();
  if (t.includes("ogg")) return "audio.ogg";
  if (t.includes("mp4") || t.includes("m4a") || t.includes("aac")) return "audio.m4a";
  return "audio.webm";
}

/**
 * Start MediaRecorder with a 250ms timeslice so dataavailable fires during capture.
 */
export function startRecorderWithTimeslice(
  stream: MediaStream,
  mimeType: string
): { recorder: MediaRecorder; chunks: Blob[] } {
  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  // Timeslice is required - without it, some browsers only emit one empty/late chunk.
  recorder.start(250);
  return { recorder, chunks };
}

/**
 * Stop the recorder and await the final dataavailable before assembling the Blob.
 */
export function stopRecorderAndCollect(
  recorder: MediaRecorder,
  chunks: Blob[]
): Promise<Blob> {
  const mimeType = recorder.mimeType || "audio/webm";

  if (recorder.state === "inactive") {
    return Promise.resolve(new Blob(chunks, { type: mimeType }));
  }

  return new Promise<Blob>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(new Blob(chunks, { type: mimeType }));
    };

    const onData = () => {
      // After stop, the last dataavailable often carries the trailing bytes.
      if (recorder.state === "inactive") {
        // Defer slightly so any same-tick chunk push completes.
        Promise.resolve()
          .then(finish)
          .catch(() => undefined);
      }
    };

    recorder.addEventListener("dataavailable", onData);
    recorder.addEventListener(
      "stop",
      () => {
        // Race: some engines fire stop before the final dataavailable.
        // Settle on microtask + short timeout so we don't hang forever.
        Promise.resolve()
          .then(() => {
            if (recorder.state === "inactive") finish();
          })
          .catch(() => undefined);
        window.setTimeout(finish, 400);
      },
      { once: true }
    );

    try {
      if (recorder.state === "recording") recorder.requestData();
    } catch {
      // requestData is best-effort
    }
    try {
      recorder.stop();
    } catch {
      finish();
    }
  });
}

/** Append audio to FormData with field name/filename/type expected by voice routes. */
export function appendAudioFormField(form: FormData, blob: Blob, filename?: string): void {
  const name = filename || filenameForMime(blob.type);
  // Ensure Blob has an explicit type when possible (xAI / multipart sniffing).
  const typed =
    blob.type && blob.type !== "application/octet-stream"
      ? blob
      : new Blob([blob], {
          type: name.endsWith(".ogg")
            ? "audio/ogg"
            : name.endsWith(".m4a")
              ? "audio/mp4"
              : "audio/webm",
        });
  form.append("audio", typed, name);
}

/** Build a user-facing STT error from JSON body ({ error, detail }). */
export function sttErrorMessage(
  data: { error?: string; detail?: unknown },
  fallback: string
): string {
  const base = (data.error || "").trim() || fallback;
  const detail =
    typeof data.detail === "string"
      ? data.detail.trim()
      : data.detail != null
        ? String(data.detail).trim()
        : "";
  if (detail && !base.includes(detail)) {
    const short = detail.length > 240 ? `${detail.slice(0, 240)}...` : detail;
    return `${base} — ${short}`;
  }
  return base;
}
