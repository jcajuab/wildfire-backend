function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function convertPlainTextToTipTap(text: string): {
  jsonContent: string;
  htmlContent: string;
} {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);

  const paragraphs = lines.map((line) => ({
    type: "paragraph" as const,
    content: [{ type: "text" as const, text: line }],
  }));

  const doc = { type: "doc", content: paragraphs };
  const jsonContent = JSON.stringify(doc);

  const htmlContent = lines
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");

  return { jsonContent, htmlContent };
}
