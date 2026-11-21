export function IntelligentPlanReview({
  record,
  locked,
  onReview,
  onGenerate,
  enabled,
}) {
  const operations = record
    ? [
        ...record.plan.visualOperations,
        ...record.plan.graphicOperations,
        ...record.plan.audioOperations,
      ]
    : [];
  return (
    <div className="space-y-4">
      <p>
        Edição inteligente: revise o plano antes de renderizar. Sem evidências
        semânticas, o planejamento deve ser técnico e conservador.
      </p>
      <button disabled={locked || !enabled} onClick={onGenerate}>
        Gerar novo plano com IA (consome API)
      </button>
      {!enabled && (
        <p role="status">Planejamento pago desabilitado no servidor.</p>
      )}
      {record && (
        <>
          <p>
            Estado: {record.status} · {record.plan.durationSeconds}s ·{" "}
            {record.plan.clips.length} trechos ·{" "}
            {record.context.narration.mode === "WITHOUT_NARRATION"
              ? "Sem narração"
              : "Com narração"}
          </p>
          <ol>
            {record.plan.clips.map((c) => (
              <li key={c.clipId}>
                Trecho {c.clipId} · fonte {c.sourceId}
              </li>
            ))}
          </ol>
          <ul>
            {operations.map((op) => (
              <li key={op.id}>
                {op.usage.resourceId}: {op.reason}
                {op.usage.parameters.text
                  ? ` · ${op.usage.parameters.text}`
                  : ""}
              </li>
            ))}
          </ul>
          {record.diagnostics.map((d, i) => (
            <p role={d.level === "ERROR" ? "alert" : "status"} key={i}>
              {d.code}: {d.message}
            </p>
          ))}
          {record.status === "READY_FOR_REVIEW" && (
            <div className="flex gap-4">
              <button disabled={locked} onClick={() => onReview("APPROVE")}>
                Aprovar plano
              </button>
              <button disabled={locked} onClick={() => onReview("REJECT")}>
                Rejeitar plano
              </button>
            </div>
          )}
          <details>
            <summary>Detalhes técnicos do plano</summary>
            <pre className="overflow-auto text-xs">
              {JSON.stringify(record.plan, null, 2)}
            </pre>
          </details>
        </>
      )}
    </div>
  );
}
