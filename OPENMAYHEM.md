# OpenMayhem integration

## Recommended first release

Use the existing OpenAI-compatible chat backend with a named OpenMayhem preset. Keep signup, email/card verification, credit claims, key issuance, and payments on OpenMayhem. The user returns to RP Suite with an API key and chooses a model. This avoids introducing a second account system or embedding payment handling in a local roleplay client.

```text
RP Suite → OpenMayhem signup → claim eligible credit → create Chat API key
        ← paste key and select a model

RP Suite browser → RP Suite local server → api.openmayhem.ai → provider network
```

## Research findings (September 9, 2026)

| Topic | Evidence and integration decision |
| --- | --- |
| API | The [quickstart](https://openmayhem.ai/docs/quickstart) documents `https://api.openmayhem.ai/v1`, bearer keys, and Chat Completions. Reuse RP Suite's client for replies and background judges. |
| Account and keys | Link to [signup](https://openmayhem.ai/signup), [credits](https://openmayhem.ai/dashboard/credits), and [API keys](https://openmayhem.ai/dashboard/keys). A Chat-scoped key is sufficient for this integration. |
| $5 offer | A direct read of the [featured campaign endpoint](https://api.openmayhem.ai/campaigns/featured) returned the `welcome` campaign with `credit_usd: "5.000000"` and `ends_at: "2026-09-14T14:22:00.000Z"`. This is a temporary offer, not a permanent signup entitlement. Fetch it dynamically and link to its offer page; otherwise link to credits. Claims require email/card verification and remain subject to eligibility. |
| Browser access | A live OPTIONS request to `/v1/chat/completions` from `Origin: http://localhost:5173` returned 204 but no `Access-Control-Allow-Origin`. A preset alone would fail in RP Suite's browser. Forward through the existing local Express server. |
| Model catalog | The public [catalog](https://api.openmayhem.ai/v1/models) returned 33 models across modalities, six with CHAT endpoints. One required tools and was unsuitable for normal conversation. Filter using endpoint and request-contract metadata; five conversational choices remained. Three had providers online at inspection time. Availability and prices change. |
| Candidate models | `hauhaucs/qwen3.6-35b-a3b-uncensored`, `prism-ml/ternary-bonsai-27b`, and `qwen/qwen3.8-27b` had live providers. The first is also the quickstart example and is a reasonable first smoke-test candidate; no roleplay quality comparison was performed. |
| Parameters | [Chat documentation](https://openmayhem.ai/docs/chat) says each model's signed contract validates parameters. Send only attributes shared by its CHAT contracts, preserve the requested token budget, and omit unsupported options. Never silently increase billed token limits. |
| Short scoring calls | RP Suite makes background calls with budgets as low as 20 tokens. Current live chat contracts expose `thinking_mode: disabled/enabled` and default to enabled. Disable thinking when all the selected model's CHAT contracts explicitly support it, so these budgets can produce useful output. |
| Structured output | Live testing found an unquoted action inside the model's choice JSON. The integration now requests the model's supported JSON-object response format for relationship scoring and choice suggestions. Choice suggestions use a `choices` envelope on this backend; other backends retain their existing array format. |
| Streaming and stopping | [Streaming documentation](https://openmayhem.ai/docs/streaming) describes SSE, optional usage-only chunks, and routes that may buffer output. Disconnecting does not guarantee cancellation of upstream work or its charge. Surface stream errors and explain empty replies; do not silently retry inference. |
| Connection status | `/v1/models` is public and cannot establish key validity or sufficient balance. Show catalog reachability explicitly. No dedicated non-billing key-introspection endpoint was found in the reviewed API. |
| Errors | [Error documentation](https://openmayhem.ai/docs/errors) distinguishes missing/rejected keys, insufficient credit (402), key limits (403), rate limits (429), and unavailable capacity (503). Preserve the provider's status/message and Retry-After. |

## Implementation boundaries

- The local router has three fixed upstream destinations: public chat catalog, public featured campaign, and authenticated Chat Completions. It does not accept arbitrary upstream URLs, forward cookies, follow redirects, persist credentials, or retry requests. RP Suite's origin guard applies before it.
- Keys stay in the existing browser settings storage and pass transiently through the RP Suite server for inference. Changing providers clears the previous key and model, preventing automatic probes from sending another provider's credentials to OpenMayhem or vice versa.
- Both onboarding surfaces share the same instructions. Public catalog queries do not send the API key. Model metadata is briefly cached and refreshed by Test connection.
- Account credit is spent by visible replies and by relationship scoring, suggestions, and other background AI calls. The integration does not grant credits or assert that every account is eligible.
- Images, speech, receipt-based cost displays, routing/trust controls, and an account-linking protocol are outside this initial chat PR.

## Follow-up recommendation for OpenMayhem

1. Add a free bearer-authenticated key-info endpoint reporting key validity, allowed scopes/models, remaining key budget, and usable credit. RP Suite can then show an accurate Ready status and balance without running inference.
2. If direct browser integrations are a product goal, define CORS for bearer-authenticated `/v1` routes separately from cookie-authenticated dashboard routes. Keep dashboard origin/CSRF protections intact. The local relay allows this RP Suite integration to work without that platform change.
3. Add model labels with availability, supported context and current input/output prices in RP Suite. Add per-request settled cost from usage/receipts, then optional limits and trust preferences. Include background requests in totals.
4. Consider an external-app authorization flow with a short-lived code and a scoped key only after the manual key flow is proven. Never put API keys in callback URLs.

## Validation

Automated tests cover model filtering, parameter adaptation, short judge budgets, credentials on provider switching, request/stream formats, empty output and errors, fixed upstream forwarding, cookie isolation, origin rejection, and preserved rate-limit headers. Build and TypeScript checks are run separately.

Live, non-billing checks verified the production campaign and catalog through the local relay, the production CORS restriction, and the settings UI rendering the $5 offer and five chat choices.

Using a user-provided API key and `hauhaucs/qwen3.6-35b-a3b-uncensored`, live calls through RP Suite's forwarding route verified a streamed fictional reply, the real `assessRelationshipMoment` function (validated affection/comfort deltas and reason), the 20-token `pickDirectorSpeaker` function, and three parsed options from `generateChoices`. A successful structured-choice call reported `usage.cost: "0.000041"` USD. This is one request's cost, not a forecast or total test spend.

The final four-call verification passed together. Authenticated reads of the corresponding request records showed all four SETTLED, totaling **$0.000178** ($0.000023 reply, $0.000107 relationship check, $0.000004 director, $0.000044 choices). Earlier diagnostic calls are additional. The full automated suite passed **2,000 tests in 106 files**, alongside TypeScript checks and the production build.

No real account was created, credit claimed, or payment submitted. Signup and verification completion, real insufficient-credit/key-budget exhaustion, and every advertised model remain untested. No key is included in source, test fixtures, or this document. Error cases are covered with mocked upstream responses. Live model availability and per-model behavior can change.
