# Full-text screening

## Goal

Review the full text (FT) of studies that passed TA screening, check each eligibility criterion, confirm the supporting evidence, and make the human final FT decision. The example review concerns digital coaching for medication adherence.

## Prerequisites

- The item is in `4. FT-Screen Queue`, normally because its TA decision was **Include** or **Unclear**.
- Current [screening criteria](screening-criteria.md) are saved.
- For screening, attach an obtainable PDF and ensure Zotero can read its text. AI checklist generation also requires an active [AI provider](../getting-started/ai-provider-setup.md).

## Steps

1. Select the item in `4. FT-Screen Queue`. If no PDF is attached, use Zotero's **Find Available PDF** or attach one manually. If the full text genuinely cannot be obtained, select **Mark Full Text Unavailable**.
2. When a PDF is detected, select **Mark Full Text Available**. This is an explicit researcher confirmation; Evidence does not infer readiness merely from attachment presence.
3. Open the PDF in Zotero's reader. In **Evidence Full-Text Screening**, select **Run AI Checklist** if you want assistance.
4. Review every criterion row. For an inclusion criterion, **Satisfied** supports inclusion and **Not satisfied** supports exclusion. An exclusion criterion appears as **Triggered** when it applies. Inspect the reasoning and the proposed evidence location in the PDF.
5. Correct a verdict when needed, confirm acceptable checks, reject unusable checks, or use **+ Add Check Manually**. If automatic quote location failed, create or choose a PDF highlight and use **Mark as Evidence**. Confirmation can materialize an automatically located evidence highlight.
6. Treat **AI suggests:** as an advisory rollup only. Any check with an exclude verdict produces an Exclude suggestion; otherwise all configured inclusion criteria need include verdicts for an Include suggestion; incomplete coverage remains **Not yet determined**.
7. Select the human final **Include** or **Exclude** decision. Exclude requires at least one confirmed exclude-verdict check. If unconfirmed AI-suggested exclusion criteria remain, choose whether to proceed after the warning. Include is blocked while any confirmed exclude-verdict check remains.
8. For batch preparation, select items in `4. FT-Screen Queue` and use **Run FT-Screening AI (Selected Items)**. Each item must already be marked full-text available and have readable PDF text; failures are reported without stopping the whole batch. **Mark Full Text Unavailable (Selected Items)** affects only selected items with no detected PDF and skips those with a PDF.
9. If necessary, open a decided item in `FT-Include`, `FT-Exclude`, or `FT-Unavailable` and select **Undo (back to FT-Screen Queue)**.

## Expected result

**Include** moves the paper from `4. FT-Screen Queue` to `FT-Include` and also to `6. Extract Coding`. **Exclude** moves it to `FT-Exclude`; confirmed triggered exclusion criteria are stored as exclusion reasons. **Mark Full Text Unavailable** moves an item with no PDF to `FT-Unavailable`. Confirmed checks remain visible in the screening history, and evidence-linked checks can navigate to their PDF highlights.

## Notes and limitations

- AI is not the final reviewer. It may omit checks, misread a criterion, or fail to locate a quote. The researcher must read the PDF, verify evidence in context, correct the checklist, and make the final decision.
- AI receives extracted PDF text, capped at 40,000 characters. Very long documents are truncated for the request, and image-only or unindexed PDFs may yield no readable text.
- Re-running the AI checklist is additive; it does not replace earlier checks. Review duplicates or superseded rows rather than assuming the newest run cleaned them up.
- Only confirmed checks count as the human-reviewed basis for finalization. For the recorded exclusion-reason list, only confirmed, triggered exclusion criteria are included; an unmet inclusion criterion can justify the Exclude gate but is not stored as a named exclusion criterion.
- Unconfirming a check does not delete an already created PDF annotation. Undoing an FT decision preserves full-text readiness and checklist evidence. Undoing an included decision removes the item from `6. Extract Coding` but preserves any coding records already created.
- Full-text unavailable is a human decision, not an AI result. In the single-item pane it is offered only when no PDF is detected.

## Related pages

- [Title and abstract screening](title-abstract-screening.md)
- [Codebook and extraction](codebook-and-extraction.md)
- [Exporting](exporting.md)
