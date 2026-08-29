// Serializer counterpart to codebookService.ts's splitCsvLine parser --
// quotes a field only when needed (contains a comma, quote, or newline),
// doubling any embedded quotes, per standard CSV escaping.
export function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsvLine(fields: (string | number)[]): string {
  return fields.map((f) => escapeCsvField(String(f))).join(",");
}
