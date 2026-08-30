import { assert } from "chai";
import {
  getLatestCodebook,
  parseCodebookCsv,
  saveCodebook,
} from "../src/modules/coding/codebookService";
import { createProject } from "../src/modules/project/projectManager";

describe("Phase 4: Codebook", function () {
  this.timeout(30000);

  it("parseCodebookCsv parses variables including quoted commas", function () {
    const csv = [
      "name,type,values,multiple,required,notes,extraction_hint",
      "study_design,categorical,RCT|Cohort|Case-control,0,1,,Look in Methods section",
      'sample_size,numeric,,0,1,"Include only final, analyzed sample",',
      "outcomes,text,,1,1,,Extract all outcomes",
      "no_type_column_value",
    ].join("\n");

    const variables = parseCodebookCsv(csv);
    assert.equal(variables.length, 4);

    assert.equal(variables[0].name, "study_design");
    assert.equal(variables[0].type, "categorical");
    assert.deepEqual(variables[0].values, ["RCT", "Cohort", "Case-control"]);
    assert.equal(variables[0].multiple, false);
    assert.equal(variables[0].required, true);

    assert.equal(variables[1].name, "sample_size");
    assert.equal(variables[1].type, "numeric");
    assert.equal(variables[1].notes, "Include only final, analyzed sample");

    assert.equal(variables[2].name, "outcomes");
    assert.equal(variables[2].multiple, true);

    // Row shorter than the header still parses using the "name" column
    // lookup rather than throwing on missing fields.
    assert.equal(variables[3].name, "no_type_column_value");
    assert.equal(variables[3].type, "text");
  });

  it("parseCodebookCsv returns an empty array for an empty file", function () {
    assert.deepEqual(parseCodebookCsv(""), []);
    assert.deepEqual(parseCodebookCsv("\n\n"), []);
  });

  it("saveCodebook/getLatestCodebook versions on repeated saves", async function () {
    const project = await createProject(`Codebook Version Test ${Date.now()}`);

    const first = await saveCodebook(project.id, [
      { name: "study_design", type: "categorical", values: ["RCT"] },
    ]);
    assert.equal(first.version, 1);

    const second = await saveCodebook(project.id, [
      { name: "study_design", type: "categorical", values: ["RCT", "Cohort"] },
      { name: "sample_size", type: "numeric", required: true },
    ]);
    assert.equal(second.version, 2);

    const latest = await getLatestCodebook(project.id);
    assert.equal(latest?.version, 2);
    assert.equal(latest?.variables.length, 2);
    assert.equal(latest?.variables[1].name, "sample_size");
  });

  it("getLatestCodebook returns null when no Codebook exists yet", async function () {
    const project = await createProject(`No Codebook Test ${Date.now()}`);
    const latest = await getLatestCodebook(project.id);
    assert.isNull(latest);
  });

});
