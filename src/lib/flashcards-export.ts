export interface FlashcardExportRow {
  direction: "en_to_pl" | "pl_to_en";
  enText: string;
  plText: string;
  score: number;
  state: string;
  reps: number;
  lapses: number;
  stability: number;
  lastReviewAt: string | null;
  dueAt: string;
  status: string;
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\r?\n/g, "<br>");
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
}

export function buildFlashcardsMarkdown(rows: FlashcardExportRow[], generatedAt = new Date()): string {
  const sortedRows = [...rows].sort(
    (a, b) => b.score - a.score || b.lapses - a.lapses || a.enText.localeCompare(b.enText, "en")
  );
  const lines = [
    "# Eksport fiszek",
    "",
    `Wygenerowano: ${formatDate(generatedAt.toISOString())}`,
    `Liczba fiszek (kierunków): ${sortedRows.length}`,
    "",
    "| Front | Back | Kierunek | Score | Stan | Powtórki | Błędy | Stabilność | Ostatnia powtórka | Następna powtórka | Status |",
    "| --- | --- | --- | ---: | --- | ---: | ---: | ---: | --- | --- | --- |",
  ];

  for (const row of sortedRows) {
    const front = row.direction === "en_to_pl" ? row.enText : row.plText;
    const back = row.direction === "en_to_pl" ? row.plText : row.enText;
    const direction = row.direction === "en_to_pl" ? "EN → PL" : "PL → EN";
    lines.push(
      `| ${escapeCell(front)} | ${escapeCell(back)} | ${direction} | ${row.score} | ${row.state} | ${row.reps} | ${row.lapses} | ${row.stability.toFixed(1)} | ${formatDate(row.lastReviewAt)} | ${formatDate(row.dueAt)} | ${row.status} |`
    );
  }

  return `${lines.join("\n")}\n`;
}
