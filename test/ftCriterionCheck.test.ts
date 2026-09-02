import { assert } from "chai";
import {
  deleteProvider,
  upsertProvider,
} from "../src/modules/ai/providerConfig";
import { resolveProjectCollections } from "../src/modules/project/collectionStructure";
import { getRootCollectionId } from "../src/modules/project/projectContext";
import { createProject } from "../src/modules/project/projectManager";
import { saveCriteria } from "../src/modules/screening/criteriaService";
import { databaseService } from "../src/modules/db/database";
import { locateQuoteInAttachment } from "../src/modules/pdf/pdfAnnotationCreator";
import { FT_SCREENING_ANNOTATION_COLOR } from "../src/utils/annotationColors";
import { markFulltextReady } from "../src/modules/screening/ftScreeningService";
import {
  addManualCheck,
  computeRollup,
  confirmCheck,
  CriterionCheck,
  deleteCheck,
  getConfirmedExclusionReasons,
  getCriterionChecks,
  getUnconfirmedExcludeChecks,
  linkAnnotationToCheck,
  parseCriterionChecks,
  runCriterionChecks,
  unconfirmCheck,
  updateCheck,
} from "../src/modules/screening/ftCriterionCheckService";

// Minimal hand-written valid single-page PDF, same technique used
// throughout the FT/Coding test suites.
const MINIMAL_PDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length 76 >>
stream
BT /F1 24 Tf 72 712 Td (FT CRITERION CHECK TEST FIXTURE TEXT) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f
trailer
<< /Size 6 /Root 1 0 R >>
startxref
0
%%EOF
`;

function writeFixturePdf(name: string): string {
  const file = Zotero.File.pathToFile(Zotero.DataDirectory.dir);
  file.append(name);
  Zotero.File.putContents(file, MINIMAL_PDF);
  return file.path;
}

async function makeTestItem(title: string): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", title);
  await item.saveTx();
  return item;
}

async function attachRealPdf(
  item: Zotero.Item,
  fileName: string,
): Promise<Zotero.Item> {
  const attachment = await Zotero.Attachments.importFromFile({
    file: writeFixturePdf(fileName),
    parentItemID: item.id,
    contentType: "application/pdf",
  });
  return attachment as Zotero.Item;
}

async function createRealAnnotation(
  attachment: Zotero.Item,
  text: string,
  color = "#ff0000",
): Promise<Zotero.Item> {
  const annotation = new Zotero.Item("annotation");
  annotation.libraryID = attachment.libraryID;
  (annotation as any).parentID = attachment.id;
  (annotation as any).annotationType = "highlight";
  (annotation as any).annotationText = text;
  (annotation as any).annotationColor = color;
  (annotation as any).annotationPosition = JSON.stringify({
    pageIndex: 0,
    rects: [[0, 0, 10, 10]],
  });
  (annotation as any).annotationSortIndex = "00000|000000|00000";
  await annotation.saveTx();
  return annotation;
}

describe("FT-Screening criterion checklist", function () {
  describe("(pure functions)", function () {
    describe("parseCriterionChecks", function () {
      it("parses a well-formed checks array", function () {
        const raw = JSON.stringify({
          checks: [
            {
              criterionType: "inclusion",
              criterionIndex: 0,
              verdict: "include",
              reasoning: "fits",
              quote: "adults aged 18-65",
            },
            {
              criterionType: "exclusion",
              criterionIndex: 1,
              verdict: "exclude",
              reasoning: "no control arm",
              quote: "single-arm study",
            },
          ],
        });
        const checks = parseCriterionChecks(raw);
        assert.equal(checks.length, 2);
        assert.equal(checks[0].criterionType, "inclusion");
        assert.equal(checks[0].verdict, "include");
        assert.equal(checks[1].criterionIndex, 1);
      });

      it("drops entries with the wrong shape instead of failing the whole batch", function () {
        const raw = JSON.stringify({
          checks: [
            {
              criterionType: "inclusion",
              criterionIndex: 0,
              verdict: "include",
            },
            { criterionType: "bogus", criterionIndex: 0, verdict: "include" },
            {
              criterionType: "inclusion",
              criterionIndex: "not-a-number",
              verdict: "include",
            },
            { criterionType: "inclusion", criterionIndex: 1, verdict: "maybe" },
          ],
        });
        const checks = parseCriterionChecks(raw);
        assert.equal(checks.length, 1);
      });

      it("returns an empty array for unparseable JSON", function () {
        assert.deepEqual(parseCriterionChecks("not json at all"), []);
      });

      it("returns an empty array when checks isn't an array", function () {
        assert.deepEqual(parseCriterionChecks('{"checks": "nope"}'), []);
      });
    });

    describe("computeRollup", function () {
      const check = (overrides: Partial<CriterionCheck>): CriterionCheck => ({
        id: 1,
        criterionType: "inclusion",
        criterionText: "x",
        verdict: "include",
        reasoning: null,
        quote: null,
        annotationKey: null,
        pendingPosition: null,
        source: "ai",
        confirmed: false,
        ...overrides,
      });

      it("returns 'unclear' when there are no checks at all", function () {
        assert.equal(computeRollup([], 1), "unclear");
      });

      it("returns 'exclude' when any check is an exclude verdict, regardless of type", function () {
        const checks = [
          check({
            criterionType: "inclusion",
            verdict: "include",
            confirmed: true,
          }),
          check({
            criterionType: "exclusion",
            verdict: "exclude",
            confirmed: true,
          }),
        ];
        assert.equal(computeRollup(checks, 1), "exclude");
      });

      it("returns 'include' only once every inclusion criterion has an include-verdict check", function () {
        const oneOfTwo = [
          check({ criterionType: "inclusion", verdict: "include" }),
        ];
        assert.equal(computeRollup(oneOfTwo, 2), "unclear");

        const bothOfTwo = [
          check({ criterionType: "inclusion", verdict: "include" }),
          check({ criterionType: "inclusion", verdict: "include" }),
        ];
        assert.equal(computeRollup(bothOfTwo, 2), "include");
      });

      // Deliberately the opposite of what this rollup used to do -- see
      // its doc comment: this is "AI:"'s own read, not the "only confirmed
      // rows ever count" rule the rest of the checklist still enforces for
      // what actually gets recorded when a paper is finalized.
      it("counts unconfirmed checks too, so the AI's own read shows up before anything is confirmed", function () {
        const checks = [
          check({
            criterionType: "exclusion",
            verdict: "exclude",
            confirmed: false,
          }),
        ];
        assert.equal(computeRollup(checks, 0), "exclude");

        const bothUnconfirmed = [
          check({
            criterionType: "inclusion",
            verdict: "include",
            confirmed: false,
          }),
          check({
            criterionType: "inclusion",
            verdict: "include",
            confirmed: false,
          }),
        ];
        assert.equal(computeRollup(bothUnconfirmed, 2), "include");
      });
    });
  });

  describe("(project + DB)", function () {
    this.timeout(60000);

    it("runCriterionChecks refuses to run without a configured provider", async function () {
      deleteProvider("default");
      const project = await createProject(`FTC No Provider Test ${Date.now()}`);
      const item = await makeTestItem("No Provider");
      let threw = false;
      try {
        await runCriterionChecks(project.id, item);
      } catch (e: any) {
        threw = true;
        assert.match(e.message, /provider/i);
      }
      assert.isTrue(threw);
    });

    it("runCriterionChecks refuses to run without configured criteria", async function () {
      upsertProvider({
        id: "default",
        name: "Test Provider",
        baseURL: "http://127.0.0.1:1/unused",
        apiKey: "test",
        model: "test-model",
      });
      const project = await createProject(`FTC No Criteria Test ${Date.now()}`);
      const item = await makeTestItem("No Criteria");
      await markFulltextReady(project.id, item, "test-user");
      let threw = false;
      try {
        await runCriterionChecks(project.id, item);
      } catch (e: any) {
        threw = true;
        assert.match(e.message, /criteria/i);
      }
      assert.isTrue(threw);
      deleteProvider("default");
    });

    it("runCriterionChecks refuses to run before fulltext_ready is confirmed", async function () {
      upsertProvider({
        id: "default",
        name: "Test Provider",
        baseURL: "http://127.0.0.1:1/unused",
        apiKey: "test",
        model: "test-model",
      });
      const project = await createProject(`FTC Not Ready Test ${Date.now()}`);
      await saveCriteria(project.id, "ft", {
        researchQuestion: "Q",
        inclusionCriteria: ["A"],
        exclusionCriteria: ["B"],
      });
      const item = await makeTestItem("Not Ready Yet");
      let threw = false;
      try {
        await runCriterionChecks(project.id, item);
      } catch (e: any) {
        threw = true;
        assert.match(e.message, /full text/i);
      }
      assert.isTrue(threw);
      deleteProvider("default");
    });

    it("confirmCheck materializes a pending auto-located highlight only once confirmed", async function () {
      const project = await createProject(`FTC Materialize Test ${Date.now()}`);
      const item = await makeTestItem("FTC Materialize Me");
      const attachment = await attachRealPdf(
        item,
        `ftc-materialize-${Date.now()}.pdf`,
      );

      const located = await locateQuoteInAttachment(
        attachment,
        "FT CRITERION CHECK TEST FIXTURE TEXT",
      );
      assert.isNotNull(located);

      await databaseService.init();
      const now = new Date().toISOString();
      await databaseService.queryAsync(
        `INSERT INTO ft_criterion_checks
        (project_id, item_key, criterion_type, criterion_text, verdict, quote, pending_position, source, confirmed, created_at, updated_at)
       VALUES (?, ?, 'inclusion', 'Adults 18-65', 'include', ?, ?, 'ai', 0, ?, ?)`,
        [
          project.id,
          item.key,
          "FT CRITERION CHECK TEST FIXTURE TEXT",
          JSON.stringify(located),
          now,
          now,
        ],
      );
      assert.equal(attachment.getAnnotations().length, 0);

      const checks = await getCriterionChecks(project.id, item.key);
      assert.equal(checks.length, 1);
      assert.isFalse(checks[0].confirmed);

      await confirmCheck(checks[0].id, item, project.id);

      assert.equal(attachment.getAnnotations().length, 1);
      const after = await getCriterionChecks(project.id, item.key);
      assert.isTrue(after[0].confirmed);
      assert.isNotNull(after[0].annotationKey);
      assert.isNull(after[0].pendingPosition);
      const annotation = Zotero.Items.getByLibraryAndKey(
        attachment.libraryID,
        after[0].annotationKey!,
      ) as Zotero.Item;
      assert.equal(annotation.annotationColor, FT_SCREENING_ANNOTATION_COLOR);
    });

    it("unconfirmCheck reverts confirmed back to pending without deleting the annotation", async function () {
      const project = await createProject(`FTC Unconfirm Test ${Date.now()}`);
      const item = await makeTestItem("FTC Unconfirm Me");
      const id = await addManualCheck(
        project.id,
        item,
        "inclusion",
        "Reports quantitative outcomes",
        "include",
        null,
      );
      let checks = await getCriterionChecks(project.id, item.key);
      assert.isTrue(checks[0].confirmed);

      await unconfirmCheck(id, project.id, item.key);
      checks = await getCriterionChecks(project.id, item.key);
      assert.isFalse(checks[0].confirmed);
    });

    it("updateCheck flips the verdict and marks the row human-sourced", async function () {
      const project = await createProject(`FTC Update Test ${Date.now()}`);
      const item = await makeTestItem("FTC Update Me");
      const id = await addManualCheck(
        project.id,
        item,
        "inclusion",
        "Adults 18-65",
        "include",
        null,
      );
      await updateCheck(
        id,
        "exclude",
        "Actually pediatric cohort",
        project.id,
        item.key,
      );
      const checks = await getCriterionChecks(project.id, item.key);
      assert.equal(checks[0].verdict, "exclude");
      assert.equal(checks[0].reasoning, "Actually pediatric cohort");
      assert.equal(checks[0].source, "human");
    });

    it("deleteCheck removes the row", async function () {
      const project = await createProject(`FTC Delete Test ${Date.now()}`);
      const item = await makeTestItem("FTC Delete Me");
      const id = await addManualCheck(
        project.id,
        item,
        "inclusion",
        "Adults 18-65",
        "include",
        null,
      );
      await deleteCheck(id, project.id, item.key);
      const checks = await getCriterionChecks(project.id, item.key);
      assert.equal(checks.length, 0);
    });

    it("linkAnnotationToCheck forces the highlight to the fixed orange color and confirms the check", async function () {
      const project = await createProject(`FTC Link Test ${Date.now()}`);
      const item = await makeTestItem("FTC Link Me");
      const attachment = await attachRealPdf(
        item,
        `ftc-link-${Date.now()}.pdf`,
      );
      const annotation = await createRealAnnotation(
        attachment,
        "the key sentence",
        "#ff0000",
      );
      assert.notEqual(
        annotation.annotationColor,
        FT_SCREENING_ANNOTATION_COLOR,
      );

      const id = await addManualCheck(
        project.id,
        item,
        "inclusion",
        "Reports quantitative outcomes",
        "include",
        null,
      );
      await linkAnnotationToCheck(
        id,
        item.libraryID,
        annotation.key,
        project.id,
        item.key,
      );

      assert.equal(annotation.annotationColor, FT_SCREENING_ANNOTATION_COLOR);
      const checks = await getCriterionChecks(project.id, item.key);
      assert.equal(checks[0].annotationKey, annotation.key);
      assert.isTrue(checks[0].confirmed);
    });

    it("getConfirmedExclusionReasons and getUnconfirmedExcludeChecks only count what's actually confirmed", async function () {
      const project = await createProject(`FTC Reasons Test ${Date.now()}`);
      const item = await makeTestItem("FTC Reasons Item");

      const confirmedId = await addManualCheck(
        project.id,
        item,
        "exclusion",
        "Wrong control group",
        "exclude",
        null,
      );
      await databaseService.init();
      // A second, AI-suggested exclude check that nobody has reviewed yet.
      const now = new Date().toISOString();
      await databaseService.queryAsync(
        `INSERT INTO ft_criterion_checks
        (project_id, item_key, criterion_type, criterion_text, verdict, source, confirmed, created_at, updated_at)
       VALUES (?, ?, 'exclusion', 'No blinding reported', 'exclude', 'ai', 0, ?, ?)`,
        [project.id, item.key, now, now],
      );

      const reasons = await getConfirmedExclusionReasons(project.id, item.key);
      assert.deepEqual(reasons, ["Wrong control group"]);

      const unconfirmed = await getUnconfirmedExcludeChecks(
        project.id,
        item.key,
      );
      assert.equal(unconfirmed.length, 1);
      assert.equal(unconfirmed[0].criterionText, "No blinding reported");

      // Confirming the manual one shouldn't be the only lever -- sanity check
      // the confirmed id really is the one that showed up above.
      const confirmed = (await getCriterionChecks(project.id, item.key)).find(
        (c) => c.id === confirmedId,
      );
      assert.isTrue(confirmed?.confirmed);
    });

    it("getConfirmedExclusionReasons and getUnconfirmedExcludeChecks ignore an unmet INCLUSION criterion even though it also stores verdict='exclude'", async function () {
      const project = await createProject(
        `FTC Inclusion Not Reason Test ${Date.now()}`,
      );
      const item = await makeTestItem("FTC Inclusion Not Reason Item");

      // "Didn't satisfy a requirement" is a different thing from "triggered
      // a configured exclusion criterion" -- both store verdict='exclude',
      // but only the latter belongs in the exclusion-reason text.
      await addManualCheck(
        project.id,
        item,
        "inclusion",
        "Reports quantitative outcomes",
        "exclude",
        null,
      );
      await databaseService.init();
      const now = new Date().toISOString();
      await databaseService.queryAsync(
        `INSERT INTO ft_criterion_checks
        (project_id, item_key, criterion_type, criterion_text, verdict, source, confirmed, created_at, updated_at)
       VALUES (?, ?, 'inclusion', 'Adults 18-65', 'exclude', 'ai', 0, ?, ?)`,
        [project.id, item.key, now, now],
      );

      const reasons = await getConfirmedExclusionReasons(project.id, item.key);
      assert.deepEqual(reasons, []);

      const unconfirmed = await getUnconfirmedExcludeChecks(
        project.id,
        item.key,
      );
      assert.deepEqual(unconfirmed, []);
    });
  });
});
