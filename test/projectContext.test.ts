// Regression coverage for the "which project owns this Collection" lookup
// added to src/modules/project/projectContext.ts alongside the fix for
// dialogs (criteriaDialog and friends in commands.ts) defaulting their
// project picker to projects[0] (an arbitrary project) instead of whichever
// project the user actually has selected in the library pane. Before this,
// projectContext.ts only mapped the 9 pane-role leaf collections (TA-Screen
// Queue, FT-Include, ...) to their owning project -- a user with the
// project's root, "1. Sources", or a per-source-database child selected
// wouldn't resolve to any project at all.
import { assert } from "chai";
import { resolveProjectCollections } from "../src/modules/project/collectionStructure";
import {
  findOwningProjectId,
  findOwningProjectIdSync,
  getRootCollectionId,
  refreshProjectPaneContextCache,
} from "../src/modules/project/projectContext";
import { createProject } from "../src/modules/project/projectManager";

describe("projectContext: findOwningProjectId / findOwningProjectIdSync", function () {
  this.timeout(60000);

  it("resolves a project's root, Sources, a per-source-database child, and a pane-role leaf collection all to that project -- and never to a sibling project", async function () {
    const projectA = await createProject(`Owner-A-${Date.now()}`);
    const projectB = await createProject(`Owner-B-${Date.now()}`);

    const rootIdA = getRootCollectionId(projectA);
    const rootIdB = getRootCollectionId(projectB);
    assert.isNotNull(rootIdA);
    assert.isNotNull(rootIdB);
    const collectionsA = resolveProjectCollections(rootIdA!);

    assert.equal(await findOwningProjectId(rootIdA), projectA.id);
    assert.equal(
      await findOwningProjectId(collectionsA.sourcesId),
      projectA.id,
    );
    assert.equal(
      await findOwningProjectId(
        collectionsA.sourceCollectionIds["Web of Science"],
      ),
      projectA.id,
    );
    assert.equal(
      await findOwningProjectId(collectionsA.taQueueId),
      projectA.id,
    );
    assert.equal(
      await findOwningProjectId(collectionsA.ftIncludeId),
      projectA.id,
    );

    // None of project A's collections belong to project B.
    assert.notEqual(await findOwningProjectId(rootIdA), projectB.id);
    assert.notEqual(
      await findOwningProjectId(collectionsA.sourcesId),
      projectB.id,
    );
  });

  it("returns null for a Collection that belongs to no Evidence project", async function () {
    const plain = new Zotero.Collection({
      name: `Not an Evidence project ${Date.now()}`,
      libraryID: Zotero.Libraries.userLibraryID,
    });
    await plain.saveTx();

    assert.isNull(await findOwningProjectId(plain.id));
    assert.isNull(await findOwningProjectId(null));
    assert.isNull(await findOwningProjectId(undefined));
  });

  it("findOwningProjectIdSync matches the always-fresh lookup once the cache is refreshed", async function () {
    const project = await createProject(`Owner-Sync-${Date.now()}`);
    const rootId = getRootCollectionId(project);
    assert.isNotNull(rootId);
    const collections = resolveProjectCollections(rootId!);

    // Before a refresh, a brand new project's collections may not be in the
    // sync cache yet -- this is the documented staleness caveat, not a bug.
    await refreshProjectPaneContextCache();

    assert.equal(findOwningProjectIdSync(rootId), project.id);
    assert.equal(findOwningProjectIdSync(collections.sourcesId), project.id);
    assert.equal(
      findOwningProjectIdSync(collections.sourceCollectionIds["Scopus"]),
      project.id,
    );
    assert.equal(
      findOwningProjectIdSync(rootId),
      await findOwningProjectId(rootId),
    );
  });
});
