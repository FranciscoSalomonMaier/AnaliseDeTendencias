export const publicationStatusLabels = {
  DRAFT: "Rascunho de envio",
  QUEUED: "Na fila",
  UPLOADING: "Enviando arquivo",
  PROCESSING: "YouTube processando",
  SCHEDULED: "Agendado no YouTube",
  PUBLISHED: "Público confirmado",
  PRIVATE: "Privado confirmado",
  UNLISTED: "Não listado confirmado",
  FAILED: "Falhou",
  CANCELLED: "Cancelado localmente",
  NEEDS_ATTENTION: "Precisa de conferência",
};
export function localDateTimeToUtc(value, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("Escolha data e horário válidos.");
  const [year, month, day, hour, minute] = value.match(/\d+/g).map(Number),
    wall = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = (instant) =>
    Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
    );
  const same = (instant) => {
    const p = parts(instant);
    return (
      [p.year, p.month, p.day, p.hour, p.minute].join("-") ===
      [
        String(year),
        String(month).padStart(2, "0"),
        String(day).padStart(2, "0"),
        String(hour).padStart(2, "0"),
        String(minute).padStart(2, "0"),
      ].join("-")
    );
  };
  let instant = wall;
  for (let i = 0; i < 4; i++) {
    const p = parts(instant);
    const represented = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
    );
    instant += wall - represented;
  }
  if (
    !same(instant) ||
    Array.from({ length: 12 }, (_, i) => (i + 1) * 900000).some(
      (offset) => same(instant - offset) || same(instant + offset),
    )
  )
    throw new Error(
      "Horário inexistente ou ambíguo nesse fuso. Escolha outro horário.",
    );
  return new Date(instant).toISOString();
}
export function publicationConfirmation(channel, title, options) {
  return `Confirmar envio real para o YouTube?\nCanal: ${channel.title} (${channel.channelId})\nVídeo/título: ${title}\nPrivacidade: ${options.privacy}\n${options.scheduledAt ? `Publicação agendada: ${new Date(options.scheduledAt).toLocaleString("pt-BR", { timeZone: options.timeZone })} (${options.timeZone})\nO arquivo será enviado agora e ficará privado até o horário.` : "O arquivo será enviado agora."}\nNenhum vídeo será excluído automaticamente.`;
}
