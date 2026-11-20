const field =
  "mt-2 block w-full rounded-lg border border-border bg-background p-3 text-white";
export function EditingAdvancedPreferences({
  value,
  options,
  disabled,
  onChange,
}) {
  return (
    <details className="rounded-lg border border-border p-4">
      <summary className="cursor-pointer font-medium">
        Configurações avançadas
      </summary>
      <p className="mt-3 text-sm text-muted-foreground">
        Preferências para utilização futura. Automático deixa a decisão para a
        IA quando o novo motor estiver disponível.
      </p>
      <fieldset disabled={disabled} className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          Ritmo dos cortes
          <select
            className={field}
            value={value.cutRhythm}
            onChange={(e) => onChange({ ...value, cutRhythm: e.target.value })}
          >
            {options.cutRhythms.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        {options.resources.map((item) => (
          <label className="block" key={item.id}>
            {item.label}
            <select
              className={field}
              value={value.resources[item.id] ?? "AUTO"}
              onChange={(e) =>
                onChange({
                  ...value,
                  resources: { ...value.resources, [item.id]: e.target.value },
                })
              }
            >
              {options.states.map((state) => (
                <option key={state.id} value={state.id}>
                  {state.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-muted-foreground">
              {item.description}
            </span>
          </label>
        ))}
      </fieldset>
    </details>
  );
}
