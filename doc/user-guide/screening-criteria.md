# Screening criteria

## Goal

Define the research question and the inclusion and exclusion criteria used for both title-and-abstract (TA) and full-text (FT) screening. For the example review, the question is whether digital coaching improves medication adherence among adults receiving long-term treatment.

## Prerequisites

- Create or open an Evidence project; see [Project management](project-management.md).
- Decide on a review question and explicit eligibility rules before requesting AI suggestions.

## Steps

1. Choose **File → Screening Criteria → Inclusion/Exclusion Criteria…**.
2. Select `SLR-Digital coaching for medication adherence` in **Project**.
3. Enter the **Research question**, for example: `Does digital coaching improve medication adherence among adults receiving long-term treatment?`
4. Enter one **Inclusion criteria** item per line, for example `Adults receiving long-term medication` and `Reports a medication-adherence outcome`.
5. Enter one **Exclusion criteria** item per line, for example `Protocol without outcome data` and `Pediatric-only population`.
6. Select **Confirm**. To edit the active set later, reopen the same command, revise the text, and confirm again.
7. Before continuing a review after an edit, verify that the revised rules express the intended eligibility standard for both TA and FT screening.

## Expected result

The dialog reports **Screening criteria saved.** The newly saved version becomes the latest active criteria set for both TA and FT AI runs. TA uses it for a liberal title/abstract judgment; FT uses the same lists for per-criterion checks against available full text.

## Notes and limitations

- The three configured content types are a research question, inclusion criteria, and exclusion criteria. Blank lines in either criteria list are ignored.
- Each save creates a new version instead of overwriting the previous database row. Existing screening records retain the criteria version associated with the run or decision; new AI runs use the latest version.
- Editing criteria does not automatically rerun AI, change confirmed decisions, move items between collections, or revise earlier criterion checks. Reassess affected studies deliberately if the eligibility standard changes.
- The dialog writes the same content as the latest TA and FT criteria sets. There is no separate TA-only or FT-only criteria editor in the current UI.
- AI screening requires an active AI provider as well as criteria. A reviewer can make a TA decision without running AI, but FT AI checklist generation also requires criteria and confirmed full-text availability.

## Related pages

- [Title and abstract screening](title-abstract-screening.md)
- [Full-text screening](full-text-screening.md)
- [AI provider setup](../getting-started/ai-provider-setup.md)
