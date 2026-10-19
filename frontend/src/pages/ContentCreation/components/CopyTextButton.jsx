import { useState } from "react";
import { ClipboardDocumentIcon } from "@heroicons/react/24/outline";

export function CopyTextButton({ text, disabled = false }) {
  const [status, setStatus] = useState({ text: null, state: "idle" });
  const copying = status.state === "copying";
  const currentStatus = status.text === text ? status.state : "idle";

  async function copy() {
    setStatus({ text, state: "copying" });
    try {
      await navigator.clipboard.writeText(text);
      setStatus({ text, state: "copied" });
    } catch {
      setStatus({ text, state: "error" });
    }
  }

  return <div className="space-y-2">
    <button type="button" onClick={() => void copy()} disabled={disabled || copying || !text.trim()} className="inline-flex items-center gap-2 rounded-xl border border-sky-400/40 px-3 py-2 text-sm text-sky-100 disabled:opacity-50">
      <ClipboardDocumentIcon className="size-4" />{copying ? "Copiando…" : "Copiar roteiro completo"}
    </button>
    {currentStatus === "copied" && <p role="status" className="text-xs text-emerald-300">Roteiro copiado! Você já pode colar em outro lugar.</p>}
    {currentStatus === "error" && <p role="alert" className="text-xs text-red-200">Não foi possível copiar. Verifique a permissão de acesso à área de transferência no navegador e tente novamente.</p>}
  </div>;
}
