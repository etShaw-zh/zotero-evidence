---
title: "Zotero Evidence: AI-assisted systematic reviews with traceable evidence"
tags:
  - systematic literature review
  - evidence synthesis
  - literature screening
  - Zotero
  - large language models
authors:
  - name: Jianjun Xiao
    orcid: 0000-0003-0000-9630
    affiliation: 1
  - name: Zhongshi Ouyang
    affiliation: 1
  - name: Ying Xue
    affiliation: 2
affiliations:
  - name: "Beijing Normal University, Beijing, China"
    index: 1
  - name: "Fujian Polytechnic of Information Technology, Fujian, China"
    index: 2
date: 26 September 2026
bibliography: paper.bib
---

# Summary

`Zotero Evidence` is an open-source plugin that turns the reference manager
Zotero into an end-to-end workbench for systematic reviews, keeping every
conclusion traceable back to its supporting evidence. Working entirely inside a
user's Zotero library, it guides a review through the full pipeline: importing
search results, title/abstract and full-text screening, codebook-based data
extraction, thematic synthesis, and reporting exports. Each stage can be
assisted by a user-configured, OpenAI-compatible large language model (LLM), yet
the reviewer remains the decision maker — every AI output is an advisory
suggestion that a human must confirm. Traceability is enforced at the point of
extraction: each confirmed value is bound to the exact quote and highlight in
the source PDF that supports it, so any datum in the final synthesis can be
followed back to its origin. Projects are stored as a fixed collection tree in a
single Zotero library and can be exported as a portable archive for backup or
sharing, or as CSV files for PRISMA reporting [@page2021prisma], screening logs,
coded data, and synthesis output.

# Statement of need

Systematic reviews are foundational to evidence-based research but are
labor-intensive: reviewers must screen large numbers of records, assess full
texts against explicit eligibility criteria, and extract data reproducibly.
Existing tools address only parts of this workload. Rayyan [@ouzzani2016rayyan]
and ASReview [@vandeschoot2021asreview] accelerate abstract screening, the
latter through active-learning prioritization, and several commercial platforms
support review management. However, such tools are typically standalone web
services, separate from the reference manager where researchers already collect
and read their literature, and most stop at screening rather than continuing
into the equally demanding steps of quote-backed extraction and synthesis.

`Zotero Evidence` addresses three gaps. First, it embeds the whole workflow in
Zotero, so items, PDFs, annotations, and review decisions live together in the
user's own library and sync through existing Zotero infrastructure, including
group libraries for teams. Second, it extends AI assistance across the entire
pipeline — title/abstract judgments, per-criterion full-text checks, codebook
extraction, and theme mining — while keeping the reviewer in control: AI results
are never final on their own, and the plugin marks an explicit human
confirmation point at each stage. Third, it makes the review auditable:
extracted values are tied to verbatim quotes and PDF highlights, screening
criteria are versioned, and agreement between AI and human, or between two human
reviewers, can be quantified with Cohen's kappa [@cohen1960kappa] for quality
control.

By combining reference management, pipeline-wide AI assistance, and
human-confirmed traceability in a single free and open-source tool,
`Zotero Evidence` gives researchers, students, librarians, and review teams a
transparent, reproducible alternative to fragmented or closed review workflows.

# Key features

- **Import and deduplication.** Import RIS, BibTeX, MEDLINE, or PubMed XML via
  Zotero's translators, with DOI-first duplicate detection and a
  year/author/title fallback.
- **Two-stage screening.** AI suggestions for title/abstract inclusion and
  per-criterion full-text checks, each requiring human confirmation, with
  results routed into a fixed collection structure.
- **Codebook extraction.** User-defined variables (categorical, numeric, or
  text) extracted from full text, each confirmed value linked to a supporting
  quote and PDF highlight.
- **Consistency.** Human–AI and human–human agreement reported as Cohen's kappa,
  including a sampled dual-reviewer reconciliation workflow.
- **Synthesis and export.** One-variable theme mining over confirmed evidence,
  and CSV exports for PRISMA flow counts, screening logs, coded data, and
  synthesis output.
- **Privacy by design.** Data stays in the user's Zotero library; only the
  minimal prompt content needed for a chosen AI feature is sent to the
  user-configured provider, and the plugin includes no telemetry.

# Acknowledgements

`Zotero Evidence` is built on the Zotero platform [@zotero] and the
zotero-plugin-toolkit and zotero-plugin-scaffold projects.

# References
