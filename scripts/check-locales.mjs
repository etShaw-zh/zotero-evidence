import console from "node:console";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parse } from "@fluent/syntax";

function messages(locale) {
  const resource = parse(
    fs.readFileSync(`addon/locale/${locale}/addon.ftl`, "utf8"),
  );
  assert.equal(
    resource.body.filter((entry) => entry.type === "Junk").length,
    0,
    `${locale}: invalid Fluent syntax`,
  );
  const map = new Map();
  for (const entry of resource.body) {
    if (entry.type !== "Message") continue;
    assert.ok(!map.has(entry.id.name), `${locale}: duplicate ${entry.id.name}`);
    map.set(entry.id.name, entry);
  }
  return map;
}
function variables(node) {
  const result = new Set();
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (value.type === "VariableReference") result.add(value.id.name);
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  }
  visit(node);
  return [...result].sort();
}
const english = messages("en-US");
for (const locale of ["zh-CN", "zh-TW"]) {
  const translated = messages(locale);
  assert.deepEqual(
    [...translated.keys()].sort(),
    [...english.keys()].sort(),
    `${locale}: message IDs`,
  );
  for (const [id, source] of english) {
    const target = translated.get(id);
    assert.deepEqual(
      target.attributes.map((a) => a.id.name).sort(),
      source.attributes.map((a) => a.id.name).sort(),
      `${locale}: ${id} attributes`,
    );
    assert.deepEqual(
      variables(target),
      variables(source),
      `${locale}: ${id} variables`,
    );
    assert.equal(
      Boolean(target.value),
      Boolean(source.value),
      `${locale}: ${id} value`,
    );
  }
  console.log(
    `${locale}: ${translated.size} messages; syntax, IDs, attributes and variables PASS`,
  );
}
assert.equal(
  fs.readFileSync("addon/LICENSE", "utf8"),
  fs.readFileSync("LICENSE", "utf8"),
);
assert.equal(
  JSON.parse(fs.readFileSync("package.json", "utf8")).license,
  "AGPL-3.0-or-later",
);
console.log("Distribution license matches original: PASS");
