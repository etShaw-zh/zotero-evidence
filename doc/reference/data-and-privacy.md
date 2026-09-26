# Data and privacy

Zotero Evidence works inside your Zotero library and keeps project data local, except when you deliberately use an AI feature, which sends prompt content to the provider you configure.

## Where data lives

- Project items, PDFs, and annotations live in the Zotero library you chose for the project and sync through Zotero as usual.
- Evidence's own records (screening, coding, synthesis, consistency, provenance, and a local AI usage log) are stored in a separate SQLite database in your Zotero profile; see [Project structure](project-structure.md).
- API keys are stored in Zotero's plugin preferences and shown as masked fields. Treat them as secrets and protect the profile and device that hold them.

## What AI features send

An AI call transmits a prompt built from your review material to the endpoint you configured. Each feature sends only what it needs:

| Feature                  | Sent to the provider                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Title/abstract screening | Research question, inclusion and exclusion criteria, and the item's title and abstract (or a note that no abstract is available) |
| Full-text screening      | Research question, inclusion and exclusion criteria, and the extracted PDF text (up to 40,000 characters)                        |
| Extract coding           | The Codebook variables with their hints, and the extracted PDF text (up to 40,000 characters)                                    |
| Synthesis (Theme Mining) | For one variable, the confirmed values and their supporting quotes (up to 300 records)                                           |

The PDF file itself is never uploaded — only extracted text is sent, and only up to the character cap. Item metadata beyond what a feature includes, your API keys, library structure, and Zotero account information are not sent.

## No telemetry

The plugin contains no analytics, telemetry, or usage tracking. The AI usage log it keeps is local to your device and exists only for your own accounting; it is never transmitted.

## Your responsibilities

- Calling an AI provider is an explicit external data transfer. Review the provider's retention, training, location, access, cost, and rate-limit terms before sending research material.
- Do not send confidential, personal, copyrighted, or restricted material to a provider unless its terms and your research approvals permit it.
- Never place real API keys, copyrighted article text, personal information, or confidential data into examples, screenshots, logs, or issue reports.

## Related pages

- [AI providers](ai-providers.md)
- [AI provider setup](../getting-started/ai-provider-setup.md)
- [Project structure](project-structure.md)
- [Limitations](limitations.md)
