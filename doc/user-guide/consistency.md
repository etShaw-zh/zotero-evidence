# Consistency

## Goal

Measure agreement between the AI and your own screening decisions, or run a sampled round in which two reviewers screen the same studies independently and reconcile the results. Agreement is reported as Cohen's kappa (κ), a chance-corrected statistic for categorical agreement. The example review concerns digital coaching for medication adherence.

## Prerequisites

- A project with recorded screening decisions; see [Title and abstract screening](title-abstract-screening.md) and [Full-text screening](full-text-screening.md).
- For human-AI consistency, items must have both an AI suggestion and a confirmed human decision that together reach a final verdict.
- For a human-human round, `2. TA-Screen Queue` must contain items to sample, and the two reviewers must each install Zotero Evidence.

## Steps

### Human-AI screening consistency

1. Choose **File → Consistency Calculation → Human-AI Screening Consistency…** and select the project.
2. Select **Compute Consistency**. The dialog reports the number of compared items, observed agreement, an overall Cohen's kappa with an interpretation band, per-category agreement, and a table of disagreements.
3. Inspect disagreements to decide whether to revisit any decision. Consistency is a diagnostic; it does not change any decision.

### Human-human screening consistency

4. Choose **File → Consistency Calculation → Human-Human Screening Consistency…** and select the project.
5. Set the sample size as a percentage of the not-yet-screened candidate pool and select **Start Round**. Evidence saves a scoped archive named like `<project>-sample.zip`.
6. Send the archive to two reviewers. Each restores it, screens every sampled item independently through both TA and FT screening, and exports their **Screening Decision Log** CSV; see [Exporting](exporting.md).
7. Back in the dialog, use **Import Reviewer A's CSV…** and **Import Reviewer B's CSV…**. Once both are collected, the round shows Cohen's kappa for the final verdict, plus diagnostic per-stage kappas for TA and FT.
8. For the latest collected round, select **Apply Agreed Results** to write the agreed decisions into the project.

## Expected result

Human-AI consistency displays kappa, observed agreement, and disagreements without altering the project. For a human-human round, **Apply Agreed Results** confirms the screening decisions for items both reviewers agreed on and reports, for example, _Applied N agreed item(s). M disagreement(s) left in TA-Screen Queue for a third reviewer._ Disagreed items remain in `2. TA-Screen Queue` tagged **⚠ Reviewer Disagreement (Evidence)** for adjudication.

## Notes and limitations

- Consistency compares each side's final verdict: a TA-exclude ends as exclude, while a TA-include or TA-unclear depends on the full-text decision. Items without a complete verdict on both sides are excluded from the count rather than guessed.
- Kappa interpretation bands shown are: below 0 poor, 0–0.2 slight, 0.2–0.4 fair, 0.4–0.6 moderate, 0.6–0.8 substantial, and 0.8 or above almost perfect. Treat them as rough guidance, not a pass/fail threshold.
- **Apply Agreed Results changes project state.** It confirms TA and FT decisions for agreed items, records agreed exclusion reasons, and marks decisions as made by reviewer agreement. It runs only on the latest collected round and skips items already moved out of the queue, so re-running does not duplicate rows.
- Reviewers must screen independently for the statistic to be meaningful. Each reviewer works in their own restored copy of the sample archive.
- A round needs both reviewer CSVs before it can be computed. If bookkeeping is lost, the dialog's recovery controls can rebuild a round from the archive and the two CSVs, matching items by stable identifier, then DOI, then normalized title.

## Related pages

- [Title and abstract screening](title-abstract-screening.md)
- [Full-text screening](full-text-screening.md)
- [Archive and restore](archive-and-restore.md)
- [Exporting](exporting.md)
