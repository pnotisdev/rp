# Running long chats cheaply on the GPU

Measured on an RTX 2080 Ti (11 GB) with `gemma-4-12B-it-qat-UD-Q4_K_XL` at 12288 context, KoboldCpp 1.118.1.
Everything below was measured on that setup, not assumed.

## TL;DR

```
koboldcpp.exe --model gemma-4-12B-it-qat-UD-Q4_K_XL.gguf --usecuda --gpulayers 99 --contextsize 12288 --smartcache 6
```

- `--smartcache 6` keeps a RAM snapshot per kind of prompt, so the background checks (relationship, choices, memory) stop erasing each other's cache. Measured: the relationship check re-reads 0.04 s instead of ~1 s. Each snapshot is up to ~1.35 GB of RAM; use `--smartcache 4` if memory is tight.
- `--swapadding` did **not** help in testing (see "The main reply cannot reuse its cache yet"). It only costs ~0.7 GB of VRAM, so leave it out.
- In the app: Settings → Generation → **Long-term memory → "Reuse the model's cache between turns"** (on by default) and **Background AI assists → "Lean"**.

Simulated cost (60 turns, `scripts/sim-cache.mts`): about **20.5 s of GPU per turn before, 13.6 s now**, with the model seeing two to three times more of the recent chat word for word. The model's own writing is ~9 s of that and can't be skipped.

## Where the time goes

| Work | Speed on this GPU | One typical turn |
| --- | --- | --- |
| Reading the prompt (prefill) | ~3000 tok/s | full 8k prompt ≈ 2.7 s |
| Writing (decode) | ~24 tok/s | 215-token reply ≈ 9 s |

Writing dominates, so the cheapest tokens are the ones never generated: fewer background calls and shorter answers from them.

## What was wrong, and the fixes

1. **Wrong turn format for this model.** Gemma 4 uses `<|turn>` / `<turn|>` special tokens. The old "Gemma" template sent `<start_of_turn>`, which this model reads as nine ordinary text tokens, and it answered with the prompt's own instructions as numbered lists. A/B on a clean first turn: old markers gave lists of steering text, the real markers gave in-character replies. There is now a **Gemma 4** template (empty thought channel on the reply cue only, as the model's own template does); it is auto-detected and an old "Gemma" setting is switched automatically.
2. **That fix exposed a second bug: every background check returned nothing.** The checks stop on `` ``` `` to cut off trailing junk, but with the correct template the model opens its answer with a `` ```json `` fence, so the stop fired at the first token and the relationship check scored nothing for the whole chat (no events, affection stuck at 0). Stops on a fence are now applied afterwards, keeping what sits between the fences.
3. **Trailing space on the reply cue** (`Sumire: `) gave stray blank lines and the occasional stray digit at the start of a reply. The cue now ends on the colon.
4. **A one-turn sliding window**, and **summarizing every ~3 turns while keeping only 12–17 messages**. Now the chat fills the window, then the oldest part is folded into the summary in one step (`compaction.ts`); the window start moves 6 messages at a time; the summary sits last in the fixed block; keyword lore and remembered facts sit after the history. Remembered facts are ranked against the live chat with no model call.
5. **A heavy relationship check.** ~3.3k prompt tokens with the instructions buried behind per-turn data, a verbose JSON answer, and all-zero scores on 3 of 4 test exchanges. Now rules first and exchange last (so a cache can reuse the rules), empty keys omitted (~110 → ~25 output tokens), overshooting scores clamped instead of zeroed, `+2` accepted, and the reply no longer sent twice.
6. **Background work after every reply.** Choices are now on request ("✦ Suggest replies"), the expression re-check runs only when the tag repeats, and a "Lean" preset sets this up. Reasoning blocks are stripped from assist output (they were landing in the stored memory summary).

## The main reply cannot reuse its cache yet

KoboldCpp can reuse a cached prompt only if everything after the point where the new prompt departs from the previous one is under about **450 tokens** (about one micro-batch). Measured on this server with `--smartcache 6 --swapadding 2048`: a tail of 429 tokens reused the cache in 0.04 s; 470 tokens re-read everything (~1 s). How long the reply was made no difference, and neither did `--swapadding`.

The app's text after the chat history (lore, world state, relationship notes, mood and steering lines) is about 1,500 tokens, so every main reply re-reads its whole prompt: ~1.7 s at 5k tokens, ~3.5 s at a full 12k context. That is the largest remaining saving, roughly 25 % of a turn at full context.

Ways to close it, none done yet:
- Shrink what follows the history below ~450 tokens (about 430 of the 1,500 are rules that never change and could move to the start of the prompt; the character-state lines are the rest).
- Try `--batchsize 1024` (hypothesis: the limit follows the micro-batch size; untested, costs some VRAM). The HUD under each reply shows `cache reused` / `full prompt re-read`, so one relaunch is enough to see.

Until then a lower "Keep after compaction" (Settings slider) is the cheaper choice, because the whole prompt is read every turn.

## Simulator numbers

`npx tsx scripts/sim-cache.mts 60` replays 60 turns through the app's real prompt builder and real background prompts, tokenized by your KoboldCpp, priced with an emulated cache at the speeds above. GPU seconds per turn, with the main reply unable to reuse its cache (as measured):

| | Old policy | Layout + compaction | + compact relationship check | + choices on request |
| --- | --- | --- | --- | --- |
| Default launch | 20.5 | 19.4 | 17.5 | 13.6 |
| `--smartcache 6` | 20.5 | 19.4 | 17.5 | 13.6 |

The script's last block (`--swapadding`, 11.1 s) assumed a longer rewind than measured; treat it as the target if the tail under 450 tokens is achieved, not as a current result.

## Things that did not help

- `--swapadding`: no change to the ~450-token limit; skip it.
- `--usemtp`: the 12B GGUF has no multi-token-prediction layers; the flag is ignored.
- `--smartcontext`: marked outdated, and context shifting is off for sliding-window models anyway.
- A draft model for speculative decoding could roughly double writing speed with no quality change, but needs a compatible small Gemma 4 GGUF (a separate download).

## Checking it works

- Settings → Generation → "Model time this session" shows seconds spent per kind of call.
- The HUD (Settings → Appearance) labels a reply `cache reused` or `full prompt re-read` by comparing its first-token time with earlier replies; a slow first token can also mean it queued behind a background check.
- In KoboldCpp's console, "processing prompt" counts per call should be a few hundred tokens for the relationship check and choices.
