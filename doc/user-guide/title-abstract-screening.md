# Title and abstract screening

## Goal

Review each citation's title and abstract (TA), optionally use an AI suggestion, and record the human decision that controls routing to full-text screening. The example review concerns digital coaching for medication adherence.

## Prerequisites

- Import records through **Import to Sources…** so new unique records enter `2. TA-Screen Queue`.
- Configure [screening criteria](screening-criteria.md) before running AI.
- Configure an [AI provider](../getting-started/ai-provider-setup.md) if you want suggestions. AI is optional for a human TA decision.

## Steps

1. Select `2. TA-Screen Queue`, then select a citation. The **Evidence Screening** pane shows the title and abstract; a missing abstract is labeled **(No abstract available)**.
2. Read the available bibliographic information. Missing details are uncertainty, not evidence that a criterion failed.
3. Optionally select **Run AI Judgment**. Review the suggested **Include**, **Exclude**, or **Unclear** decision, its reasoning, and any highlighted phrases copied from the title or abstract. On a later run the button reads **Re-run AI Judgment**.
4. Make the final human choice by selecting **Include**, **Exclude**, or **Unclear**. You may decide without running AI, and you may disagree with its suggestion.
5. For a batch AI run, select regular items in `2. TA-Screen Queue`, right-click, and choose **Run TA-Screening AI (Selected Items)**. Review the reported failures; one failed item does not stop the remaining items.
6. Use **Confirm AI Suggestions (Selected Items)** only after deciding that every selected pending suggestion is acceptable. It confirms each available AI suggestion directly and skips items with no pending suggestion or an existing human decision.
7. If a decision was wrong, open the item in `TA-Include`, `TA-Exclude`, or `TA-Unclear` and select **Undo (back to TA-Screen Queue)**.

## Expected result

The citation leaves `2. TA-Screen Queue` and appears in exactly one TA result collection. **Include** routes it to `TA-Include` and also `4. FT-Screen Queue`; **Unclear** routes it to `TA-Unclear` and also `4. FT-Screen Queue`; **Exclude** routes it to `TA-Exclude` and does not send it to FT screening. The result pane shows the stored AI suggestion, when present, and the human decision.

## Notes and limitations

- AI output is advisory and never becomes final merely because it was generated. The individual decision buttons or the explicit batch confirmation action provide human confirmation.
- The TA prompt is intentionally liberal: it should exclude only when the title or abstract clearly conflicts with the criteria. When important information is absent, prefer human review and, where appropriate, **Unclear**.
- A missing abstract does not block manual or AI screening, but the AI receives the fact that no abstract is available. Verify the citation and obtain more information when the title alone is insufficient.
- A malformed AI response is retained as reasoning and treated as **Unclear** rather than aborting the run. Empty or malformed keyword output simply produces no highlights.
- Re-running AI adds a newer screening record; it does not itself move the item. Undo clears the human confirmation and routing while retaining the AI suggestion.
- Batch confirmation can rapidly make final decisions and route items. It does not pause for item-by-item reasoning review, so inspect suggestions first.

## Related pages

- [Importing and deduplication](importing-and-deduplication.md)
- [Screening criteria](screening-criteria.md)
- [Full-text screening](full-text-screening.md)
