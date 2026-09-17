# OpenMayhem integration

## Krea base-image workflows (September 12, 2026)

The image picker combines the paginated IMAGES catalog with supported image-producing WORKFLOWS entries. Users see Z-Image Turbo, Krea 2 Turbo, and Krea 2 Quality when their providers are available. Stable API IDs are saved separately from display names. Discovery still refreshes every 30 seconds/on focus, and generation rechecks availability before submitting. A catalog failure does not silently retain an obsolete selectable list.

Krea support is based on `workflow_media` schema version 1 (`krea2-turbo` and `krea2-raw`), the published workflow policy, request contracts, and live image capacity. A small base-image adapter constructs ten reviewed graph roles from the advertised loader parts and allowed links. It never adds LoRA nodes, uses the model's default preset, and selects the published `turbo-negative` preset when a negative prompt is supplied. Unsupported metadata, required extra nodes, invalid sampling values, and unsupported inputs are rejected before submission. Other workflow families, image editing, references and optional LoRAs are outside this release.

Slot dimensions fit the policy's grid, dimension bounds, and pixel capacity. Each job produces one image. Krea jobs go through the fixed `/api/openmayhem/workflows` relay and reuse image artifact validation, polling, cancellation, MIME preservation, and local asset storage. No new account, workflow editor, SDK dependency, or provider-specific setup is exposed in RP Suite.

One OpenMayhem key now serves chat, images and voice. Editing it on an OpenMayhem settings page updates the shared key; switching chat to another provider clears that provider field without leaking the shared secret. On upgrade, a saved media key takes precedence if both legacy fields differ; otherwise an existing OpenMayhem chat key is reused. Restricted API keys need Chat, Images, Audio Speech, and Workflows permissions for the corresponding features.

Test fixtures were captured from the public catalog on September 12; provider identities and optional LoRA catalogs were removed. They are test data only, never bundled as runtime model choices. Automated coverage includes graph construction without LoRAs, Turbo negative prompts, capacity/ratio fitting, unknown metadata rejection, live paginated discovery, workflow execution, cancellation, relay authorization, and shared-key migration/isolation.

Live validation generated images with all three models. Browser checks covered the three friendly choices, persisted Krea selection, a Turbo preview, and a Quality portrait created and reopened from local avatar storage at 832x1216. Separate image-client calls downloaded a Z-Image landscape and a 768x512 Turbo landscape with a negative prompt, seed 42, ten graph nodes, and zero LoRA nodes. A temporary OpenMayhem maintenance 503 was displayed without automatic resubmission; an explicit retry later succeeded. Browser Stop returned to idle without a cancellation error, but the provider job ultimately completed: this is cancellation-request handling, not a guarantee of stopped work or refunded credit.

Validation: 2,142 tests across 114 files passed; the final metadata checks were also retested separately. TypeScript and production build are checked before opening the PR. The browser retains a local `Krea integration test` character for manual inspection. No API keys or generated personal assets are included in the PR.

## Recommended first release

Use the existing OpenAI-compatible chat backend with a named OpenMayhem preset, plus dedicated async image and speech adapters in the existing media workflows. Keep signup, email/card verification, credit claims, key issuance, and payments on OpenMayhem. The user returns to RP Suite with an API key and chooses a model. This avoids introducing a second account system or embedding payment handling in a local roleplay client.

```text
RP Suite → OpenMayhem signup → claim eligible credit → create Chat API key
        ← paste key and select a model

RP Suite browser → RP Suite local server → api.openmayhem.ai → provider network
```

## Research findings (September 9, 2026)

| Topic | Evidence and integration decision |
| --- | --- |
| API | The [quickstart](https://openmayhem.ai/docs/quickstart) documents `https://api.openmayhem.ai/v1`, bearer keys, and Chat Completions. Reuse RP Suite's client for replies and background judges. |
| Account and keys | Link to [signup](https://openmayhem.ai/signup), [credits](https://openmayhem.ai/dashboard/credits), and [API keys](https://openmayhem.ai/dashboard/keys). Enable Chat for conversation, Images for image generation, and Audio Speech for TTS. |
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

- The local router exposes fixed paths for the public catalog/campaign, authenticated Chat Completions, Images, Audio Speech, job status/cancellation, and owned artifacts. It validates modality/cursor queries and resource IDs, does not accept caller-provided upstream URLs, forward cookies, persist credentials, or retry inference. Artifact redirects are accepted only from the fixed API, require HTTPS, and receive no bearer credentials. Other redirects are rejected. RP Suite's origin guard applies before it.
- Keys stay in the existing browser settings storage and pass transiently through the RP Suite server for inference. Changing providers clears the previous key and model, preventing automatic probes from sending another provider's credentials to OpenMayhem or vice versa.
- Both onboarding surfaces share the same instructions. Public catalog queries do not send the API key. Every catalog page is fetched using next_cursor; endpoint caches are separate. Metadata is briefly cached and can be refreshed manually.
- All chat, image, and speech model dropdowns require a positive `providers_available` count and exclude stale availability. Busy-only, offline, and unknown availability are not selectable. The public list refreshes every 30 seconds while mounted and when the window regains focus. If no providers are available, show an empty disabled dropdown instead of falling back to manual entry. Keep metadata for saved selections separately so temporary provider load does not discard the chosen model's contract. Availability can still change between selection and dispatch; the provider's response remains authoritative.
- Account credit is spent by visible replies and by relationship scoring, suggestions, and other background AI calls. The integration does not grant credits or assert that every account is eligible.
- Receipt-based cost displays, routing/trust controls, voice cloning, and an account-linking protocol remain outside this PR.

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

## Interactive roleplay check

A separate four-turn Sumire conversation was exercised through the actual browser UI with the same Qwen 3.6 model, starting with the Library regulars relationship preset. This covered both visual novel and transcript views, automatic relationship scoring, generated choices, a direct correction, and recall of details from earlier turns.

- All four replies arrived without an API error. The UI reported approximately 1.7–2.0 seconds to first token and 2.4–2.9 tokens/second; these are the app's displayed metrics, not an independent throughput benchmark.
- The character kept her reserved voice and ultimately recalled both the user's preference for mysteries with maps and the green train ticket used as a bookmark.
- Bond warmth changed from 20 to 21. The relationship panel showed bounded stat changes and two explanatory events, including appreciation of the user's reading habits.
- Quality was uneven: one reply missed a direct question and confused ownership of the bookmark. An explicit correction recovered the question, but the memory system still saved an incorrect fact attributing the user's ticket to Sumire.
- Suggested choices rendered, but one set included accepting a pastry gift that had never been offered. JSON mode solves output structure, not grounding in the conversation.

The integration is usable for exploratory play. Before recommending a default roleplay model, compare conversation quality across models and improve ownership checks for remembered facts and transcript grounding for suggested actions. These observations do not establish whether the remaining quality issues originate in the model, prompt construction, or memory/choice processing. This UI session is additional to the four-call cost measurement above.


## Images and speech

The [media documentation](https://openmayhem.ai/docs/media) describes asynchronous jobs for both `/v1/images/generations` and `/v1/audio/speech`. These endpoints do not return the inline image/audio responses used by many other OpenAI-compatible services. The [routing documentation](https://openmayhem.ai/docs/routing) documents cursor pagination and live availability. Both were cross-checked against the local OpenMayhem API source and the production catalog.

- Settings > Images and Settings > Voice each offer OpenMayhem and an independent live model selection. One dedicated OpenMayhem media key is shared by those two features; a button can explicitly copy the chat key. This lets images and speech work even when chat uses a different provider. The media key is never passed to another provider.
- New compatible models appear automatically from all catalog pages. Models need a positive available-provider count and non-stale availability. Required inputs must be supported by RP Suite; reference-media-only and non-playable speech contracts are excluded. Catalog errors and all-offline states show no selectable models. A saved selection is retained but is not added back as an available option. Availability can change before dispatch; media requests recheck it immediately before submission.
- Image generation uses the model's advertised steps/guidance defaults, one image per job, and dimensions fitted to the slot's aspect ratio and the model's size constraints. For Z-Image Turbo this avoids RP Suite's local default of 28 steps exceeding its 7-9 step contract. A fresh random seed is sent when no seed is specified. PNG/JPEG/WebP MIME types are preserved through avatar, sprite, background, and gallery paths.
- Jobs are submitted once, polled, and downloaded by validated resource IDs. Generation has a five-minute overall deadline. Stop/unmount requests DELETE for an unfinished job, including when Stop arrives before submission returns its ID. Failed cancellation is reported honestly, and a lost submission response directs the user to check their dashboard before retrying. Work already performed may still be billed.
- Speech uses the selected model's published voices and a browser-playable format. The same model/key serves the settings preview and Visual Novel manual/automatic voice. Character voice IDs are selected from that contract; a different provider override requires configuring that provider globally first so credentials cannot go to the wrong service. Unsupported voices and overlong text fail before a billed submission. Changing lines/settings or stopping aborts pending OpenMayhem speech and releases audio URLs.
- Saved generated images are downloaded into RP Suite's existing local asset storage; they do not depend on expiring OpenMayhem artifact URLs. Audio is fetched for playback on demand, without a persistent speech cache.

Production catalog inspection on September 9 found `tongyi/z-image-turbo` (image generation) and `resembleai/chatterbox` (speech), with Chatterbox exposing only the `default` voice. These IDs and voices are observations, not hardcoded options.

Live browser verification used the supplied key to generate and display a 768x768 watercolor lighthouse through Settings > Images, and to synthesize/play the voice settings test phrase. Visual Novel read-aloud was exercised with the existing isolated Qwen test conversation. Automated coverage includes paginated model discovery, offline/stale/incompatible filtering, contract adaptation, voice validation, async polling/downloads, cancellation before the job ID arrives, failed cancellation, terminal/provider errors, incorrect artifacts, and credential isolation. Real insufficient-credit exhaustion and every possible future model remain untested.


Final media validation: **2,027 tests across 109 files**, full TypeScript checks, and production build passed. A later live cancellation fix was rechecked with the 23 focused media/router tests. The browser tests also generated an 832x1216 lighthouse-keeper portrait, saved/reopened it from `/avatars/characters/.../avatar.png`, selected/saved the supported character voice override, and generated/saved one Neutral expression through the batch workflow. A separate media-test character was retained locally.

During the final live catalog comparison, `qwen/qwen3.8-27b` changed to zero available providers and correctly disappeared from the chat dropdown. Images and speech retained their separate saved model choices across navigation/reloads.

The browser Stop test exposed a production-specific rejection of a bodyless DELETE carrying JSON Content-Type. The relay now sends Content-Type only for POST bodies; regression tests cover this. A fresh live speech job returned 202/running, its cancellation request returned 200/running, and the browser Stop retest returned to idle without the earlier error. This confirms cancellation acceptance, not instantaneous provider termination or a refund. The earlier failed-cancellation job had already completed when inspected and cost $0.000181; this is not the total test spend.
