export const youtubePeriods = { today: "Hoje", "7d": "7 dias", "30d": "30 dias", "1y": "1 ano" };

export function formatHistoryDuration(seconds) {
  const value = Math.max(Number(seconds) || 0, 0);
  if (value < 60) return "menos de 1 minuto";
  if (value < 3600) return `${Math.floor(value / 60)} min`;
  if (value < 86400) return `${Math.floor(value / 3600)} h`;
  const days = Math.floor(value / 86400);
  return `${days} ${days === 1 ? "dia" : "dias"}`;
}

export function describeRankingHistory(videos) {
  if (!videos.length) return "Ainda não há vídeos com snapshots para esta região. Aguarde a coleta horária.";
  const hasMeasuredInterval = videos.some((video) => Number(video.actualHistorySeconds) > 0);
  if (!hasMeasuredInterval) return "Ainda não há duas coletas em instantes diferentes neste período. O crescimento aparece como zero até a próxima coleta; os filtros podem mostrar a mesma lista.";
  if (videos.some((video) => !video.hasFullPeriodData)) {
    return "Histórico parcial: o crescimento considera apenas o intervalo observado de cada vídeo. Períodos maiores que o histórico disponível podem mostrar os mesmos valores e a mesma ordem.";
  }
  return "Ranking atualizado pelas visualizações ganhas no período.";
}
