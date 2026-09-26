# AI provider setup

## Goal

Configure one AI service for screening, coding, and synthesis suggestions.

## Prerequisites

- Zotero Evidence is [installed](installation.md).
- An API endpoint, model identifier, and any required API key from an
  OpenAI-compatible service.
- Permission to send the relevant article text and metadata to that service.

## Steps

1. In Zotero, choose **File → AI Settings → AI Provider Settings…**.
2. In **Choose an AI provider to configure**, select a built-in provider or
   **Custom**. A built-in choice supplies its endpoint; **Custom** lets you
   enter another compatible service.
3. Check **API endpoint (chat/completions URL)**. It must be the full chat
   completions endpoint, for example
   `https://api.research-example.invalid/v1/chat/completions`, not merely the
   service's site or API root.
4. Enter the **API key** required by the service. The field hides the value on
   screen. Never paste a real key into documentation, screenshots, logs, or an
   issue report.
5. Set **Model**. You can type an exact model identifier manually, such as
   `review-model-small`. Alternatively, choose **Fetch models** and click a
   returned model. Model discovery derives `/models` from an endpoint ending in
   `/chat/completions`; manual entry remains available if discovery is
   unsupported or fails.
6. Choose **Concurrency (simultaneous AI requests)**. The default is 3. Saved
   values are rounded and limited to 1–10; a higher value can trigger provider
   rate limits.
7. Choose **Test connection**. A success displays
   **✓ Connected successfully**. A failure displays
   **✗ Connection failed:** followed by the available error detail.
8. Choose **Confirm** to save this slot and make it the active provider.

## Expected result

The provider picker marks the saved slot **In use** and shows its model and
concurrency. AI actions can now use that endpoint and model.

## Notes and limitations

**Review privacy and cost first.** AI features send prompts derived from your
review material to the endpoint you configure. Check the provider's retention,
training, location, access, cost, and rate-limit terms. Do not send confidential,
personal, copyrighted, or restricted material without authorization.

- Zotero Evidence uses an OpenAI-compatible, non-streaming chat-completions
  request. A preset does not guarantee that a provider, account, key, or model
  will accept a particular request.
- **Fetch models** is a convenience. If the URL cannot be derived, the network
  request fails, authentication is rejected, or the response has no `data[]`
  list, the dialog reports **Failed to fetch the model list.** with available
  details. You can still type the model manually.
- Connection and model-list requests fail promptly on HTTP errors. When a
  provider returns an error message in the expected response shape, the plugin
  surfaces it; otherwise Zotero's underlying error may be shown.
- Saving stores the configuration in Zotero's plugin preferences. Treat the API
  key as a secret and protect the Zotero profile and device that contain it.
- See [AI providers](../reference/ai-providers.md) for compatible endpoint
  details and [Data and privacy](../reference/data-and-privacy.md) before using
  research material with an external service.

## Related pages

- [Installation](installation.md)
- [Create your first project](first-project.md)
- [AI providers reference](../reference/ai-providers.md)
- [Data and privacy](../reference/data-and-privacy.md)
