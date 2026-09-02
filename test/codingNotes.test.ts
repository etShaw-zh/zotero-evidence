import { assert } from "chai";
import { getNote, saveNote } from "../src/modules/coding/codingNotesService";
import { createProject } from "../src/modules/project/projectManager";

describe("Coding: codingNotesService (project + DB)", function () {
  this.timeout(30000);

  it("getNote returns '' when nothing has been saved yet", async function () {
    const project = await createProject(`Notes Empty Test ${Date.now()}`);
    assert.equal(await getNote(project.id, "ABCD1234"), "");
  });

  it("saveNote/getNote round-trips, and a later save overwrites in place rather than versioning", async function () {
    const project = await createProject(`Notes Round Trip Test ${Date.now()}`);
    await saveNote(project.id, "ABCD1234", "Speaks directly to RQ2.");
    assert.equal(
      await getNote(project.id, "ABCD1234"),
      "Speaks directly to RQ2.",
    );

    await saveNote(project.id, "ABCD1234", "Revised: actually more RQ1.");
    assert.equal(
      await getNote(project.id, "ABCD1234"),
      "Revised: actually more RQ1.",
    );
  });

  it("saving a blank/whitespace-only note clears it back to ''", async function () {
    const project = await createProject(`Notes Clear Test ${Date.now()}`);
    await saveNote(project.id, "ABCD1234", "A note worth keeping.");
    assert.notEqual(await getNote(project.id, "ABCD1234"), "");

    await saveNote(project.id, "ABCD1234", "   \n  ");
    assert.equal(await getNote(project.id, "ABCD1234"), "");
  });

  it("notes are scoped per project+item -- a different item or a different project never sees another's note", async function () {
    const projectA = await createProject(`Notes Scope A ${Date.now()}`);
    const projectB = await createProject(`Notes Scope B ${Date.now()}`);

    await saveNote(projectA.id, "ITEM0001", "Project A, item 1.");
    await saveNote(projectA.id, "ITEM0002", "Project A, item 2.");
    await saveNote(projectB.id, "ITEM0001", "Project B, item 1.");

    assert.equal(await getNote(projectA.id, "ITEM0001"), "Project A, item 1.");
    assert.equal(await getNote(projectA.id, "ITEM0002"), "Project A, item 2.");
    assert.equal(await getNote(projectB.id, "ITEM0001"), "Project B, item 1.");
    assert.equal(await getNote(projectB.id, "ITEM0002"), "");
  });

  it("strips control characters mozStorage rejects on bind, same as AI-response text elsewhere", async function () {
    const project = await createProject(`Notes Sanitize Test ${Date.now()}`);
    // An embedded NUL (or similar C0 control char) -- built from a char
    // code rather than a literal escape, same reasoning as sanitize.ts's
    // own construction of the characters it strips.
    const withControlChar = `before${String.fromCharCode(0)}after`;
    await saveNote(project.id, "ABCD1234", withControlChar);
    assert.equal(await getNote(project.id, "ABCD1234"), "beforeafter");
  });
});
