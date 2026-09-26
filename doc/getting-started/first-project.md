# Your first project

This walkthrough uses one adaptable fictional question throughout: **In adults
with chronic insomnia, does online cognitive behavioral therapy improve sleep
quality compared with usual care?** Replace its topic, criteria, and Codebook
variables with those for your own review.

## Goal

Create a small Evidence project and follow one review from imported search
records to an archived project.

## Prerequisites

- Zotero Evidence is [installed](installation.md).
- An AI provider is [configured](ai-provider-setup.md) if you plan to generate
  AI suggestions.
- Your own supported bibliographic search export, with no confidential or
  restricted content. The plugin does not supply a sample file for this
  walkthrough.

## Steps

1. Choose **File → Evidence Project → New Project…**, enter a short name such as
   `Online CBT for insomnia`, select a writable library if Zotero offers a
   choice, and choose **Confirm**. The project root name receives an `SLR-`
   prefix.
2. Choose **File → Import Literature → Import to Sources…**. Select the project,
   identify the source database, choose the exported search-results file, and
   confirm. This route imports into **1. Sources**, filters duplicate imported
   records, and puts new records in **2. TA-Screen Queue**. See
   [Importing and deduplication](../user-guide/importing-and-deduplication.md).
3. Choose **File → Screening Criteria → Inclusion/Exclusion Criteria…**. Enter
   the fictional research question, then add one inclusion or exclusion
   criterion per line. See
   [Screening criteria](../user-guide/screening-criteria.md).
4. Choose **File → Codebook → Add Codebook Variable…** or
   **Import Codebook (CSV)…**. For this review, variables might describe the
   population, intervention, comparator, and sleep-quality outcome. Finalize
   the intended variables before extraction. See
   [Codebook and extraction](../user-guide/codebook-and-extraction.md).
5. Open **2. TA-Screen Queue**. For each record, generate a **Run AI Judgment**
   suggestion if wanted, inspect the title and abstract yourself, and confirm
   your own Include, Exclude, or Unclear decision. See
   [Title and abstract screening](../user-guide/title-abstract-screening.md).
6. Open **4. FT-Screen Queue**. Obtain and attach the appropriate full text,
   review each criterion and its supporting evidence, confirm or correct the
   checks, and make the final full-text decision. See
   [Full-text screening](../user-guide/full-text-screening.md).
7. Open **6. Extract Coding**. Generate suggestions, compare every proposed
   value and quote with the paper, and confirm only supported evidence. AI
   suggestions do not become confirmed coding evidence on their own.
8. Use **File → Export Data** to export the data needed for analysis and
   reporting. Available commands cover PRISMA data, the screening decision log,
   Extract Coding data, and Theme Mining data. See
   [Exporting](../user-guide/exporting.md).
9. Choose **File → Evidence Project → Archive Project…**, select the project,
   and save its `.zip` in a protected backup or sharing location. See
   [Archive and restore](../user-guide/archive-and-restore.md).

## Expected result

You have an `SLR-Online CBT for insomnia` project whose records have moved
through the appropriate TA, FT, and coding collections according to your
confirmed decisions. You also have the chosen exports and a restorable project
archive.

## Notes and limitations

- The normal **Import to Sources…** path performs source filing and
  deduplication. **Import to Coding…** bypasses TA screening, FT screening,
  Sources, and that deduplication pipeline; use it only for literature screened
  elsewhere.
- A citation record is not necessarily a full-text PDF. Full-text screening and
  quote-backed coding require you to obtain and review the appropriate paper.
- AI suggestions can be wrong. A researcher remains responsible for every
  confirmed screening decision, extracted value, and interpretation.
- An archive is a portable project snapshot, not a replacement for a broader,
  tested backup policy.

## Related pages

- [Project management](../user-guide/project-management.md)
- [Importing and deduplication](../user-guide/importing-and-deduplication.md)
- [Codebook and extraction](../user-guide/codebook-and-extraction.md)
- [Archive and restore](../user-guide/archive-and-restore.md)
