// Zotero's SQLite layer (mozStorage) rejects a TEXT parameter that contains
// an embedded NUL character (and some other C0 control chars), throwing a
// DOMException ("InvalidCharacterError: An invalid or illegal string was
// specified") from the bind call -- which aborts the whole statement (and,
// inside a loop like generateSuggestions' insert loop, silently discards
// every record after the offending one, or all of them if it's the first).
// AI responses are the main place this shows up in practice: a model can
// echo back a stray control character from source PDF text it was quoting,
// or emit one on its own. Strip these at the JSON-parsing boundary, before
// anything derived from an AI response reaches a DB insert -- legitimate
// tab/newline/CR are left alone since quotes can genuinely span lines.
//
// Built from character codes rather than written as literal \u escapes in
// this file's source text, so the control characters themselves never have
// to appear as raw bytes here.
const KEPT_CODES = new Set([9, 10, 13]); // \t \n \r
let controlChars = "";
for (let code = 0; code <= 31; code++) {
  if (!KEPT_CODES.has(code)) controlChars += String.fromCharCode(code);
}
const CONTROL_CHAR_RE = new RegExp(`[${controlChars}]`, "g");

export function sanitizeDbText(s: string): string {
  return s.replace(CONTROL_CHAR_RE, "");
}
