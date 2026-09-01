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

// Parser counterpart to toCsvLine/escapeCsvField above -- used to read back
// a CSV this plugin itself wrote (e.g. a reviewer's exported screening
// log), not arbitrary third-party CSVs. Line-based (a field embedding a
// literal newline round-trips through export but not back through this),
// same tradeoff codebookService.ts's own copy of this already accepts.
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}
