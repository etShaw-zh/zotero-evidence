# Synthesis

## Goal

Group the confirmed coded values for a single Codebook variable into a small number of higher-level themes, so recurring concepts across studies become visible. This feature is called Theme Mining. The example review concerns digital coaching for medication adherence.

## Prerequisites

- Confirmed coding records exist for the variable you want to synthesize; see [Codebook and extraction](codebook-and-extraction.md).
- An active [AI provider](../getting-started/ai-provider-setup.md).

## Steps

1. Choose **File → Synthesis Analysis → Theme Mining…**.
2. Select the project and the Codebook variable to analyze. Theme Mining runs on one variable at a time; repeat for each variable you want to synthesize.
3. Select **Run Theme Mining**. The dialog shows **Analyzing…** while it works.
4. Review the results table, which lists the source study, variable name, value, quote, and the assigned theme for each coded data point.

## Expected result

The dialog reports **Theme mining complete.** and each confirmed value for the variable is assigned exactly one theme label; values that share a concept receive the identical label, so scanning the theme column reveals the clusters. Themes are stored with their coding records and can be exported; see [Exporting](exporting.md).

## Notes and limitations

- Theme Mining is advisory, like the other AI features. The themes are the AI's grouping of your confirmed values; review them before relying on them for analysis or reporting.
- Themes are not editable in the dialog. Re-running Theme Mining performs a full regenerate for the analyzed rows, overwriting their previous theme labels rather than merging with an earlier run.
- The AI receives only the values and their supporting quotes for the selected variable, not study titles, full text, or the research question. A run sends at most 300 confirmed records for the variable; if there are more, only the first 300 are analyzed and the remaining records keep any theme they already had.
- The results table shows at most 150 rows and notes when it is showing a subset of the records.
- A variable with no confirmed coding records cannot be synthesized; the dialog reports that there are no confirmed records yet. A failed run reports **Theme mining failed.** with the available provider detail.

## Related pages

- [Codebook and extraction](codebook-and-extraction.md)
- [Exporting](exporting.md)
- [AI providers](../reference/ai-providers.md)
