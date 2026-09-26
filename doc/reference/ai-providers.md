# AI providers

This page explains the AI configuration concepts referenced by [AI provider setup](../getting-started/ai-provider-setup.md).

## Request type

Zotero Evidence sends OpenAI-compatible, non-streaming chat-completions requests. The configured **API endpoint** must be the full chat/completions URL, for example `https://api.openai.com/v1/chat/completions`, not the service's site or API root. The API key is sent as a bearer token.

## Configuration fields

Each provider slot stores an identifier and display name, the endpoint URL, the API key, the model identifier, and a concurrency setting:

- **Model.** Type an exact model identifier, or use **Fetch models** to list what the endpoint offers. Model discovery derives a `/models` URL from an endpoint ending in `/chat/completions`; manual entry remains available if discovery is unsupported or fails.
- **Concurrency.** The number of simultaneous AI requests. The default is 3; saved values are limited to 1–10. Higher values can trigger provider rate limits.

## Built-in presets

The provider picker offers presets that supply an endpoint for common OpenAI-compatible services, alongside a **Custom** option for any other compatible endpoint:

| Preset          | Endpoint                                                |
| --------------- | ------------------------------------------------------- |
| OpenAI          | `https://api.openai.com/v1/chat/completions`            |
| DeepSeek        | `https://api.deepseek.com/v1/chat/completions`          |
| Zhipu GLM       | `https://open.bigmodel.cn/api/paas/v4/chat/completions` |
| Moonshot (Kimi) | `https://api.moonshot.cn/v1/chat/completions`           |
| Custom          | user-supplied                                           |

A preset supplies the endpoint only. It does not guarantee that a given provider, account, key, or model will accept a particular request; you still supply your own key and model.

## Requests, timeouts, and usage

- AI calls use a 5-minute timeout, which accommodates large full-text prompts, and fail fast on HTTP errors rather than retrying silently, so real errors surface promptly.
- Evidence records a local, private usage log (provider, model, feature, and token counts) that you can review under **File → AI Settings**. This log stays on your device and is never transmitted.

## What each feature sends

See [Data and privacy](data-and-privacy.md) for exactly what content each AI feature sends to the endpoint you configure.

## Related pages

- [AI provider setup](../getting-started/ai-provider-setup.md)
- [Data and privacy](data-and-privacy.md)
- [Limitations](limitations.md)
