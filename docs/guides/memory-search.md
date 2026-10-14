# Documents and memory search

Settings, Generation, **Documents and memory search**. It finds the passages that best match what was just said and adds them to the prompt, from two places:

- **Older messages** of the chat, which no longer fit in the window or have been folded into the summary. Each message is stored as it is written.
- **Documents** you add: text, notes, a wiki page, a character's backstory. They can apply to every chat, or only to chats with one character.

## What it needs

An embeddings model loaded on a server that speaks the OpenAI `/v1/embeddings` format: KoboldCpp started with `--embeddingsmodel`, llama.cpp with `--embedding`, Ollama, LM Studio, or a hosted one. Leave **Embeddings server** blank to use the chat server. **Test the connection** shows the vector size when it works.

Switching to a different embeddings model later is safe: passages made by another model are skipped rather than compared, but they stop matching until the document is added again.

## How it works

1. Before each reply the last two messages are turned into a vector and compared with everything stored, on the server.
2. The best few matches above the minimum score go in the prompt after the chat history, under a short note that they are background, not something to repeat. They are placed there so the start of the prompt stays the same turn to turn and the model's cache keeps working.
3. Messages that are already in the prompt are never fetched back.
4. After each reply the chat's new messages are stored, up to 24 at a time, so a long existing chat catches up over a few replies.

If the embeddings server is down, the reply goes ahead without the extra passages and a note goes to the browser console.

## Settings

- **Passages per reply** (default 4) and **Minimum match** (default 30%): raise the minimum if unrelated passages appear.
- **Passage size** (default 800 characters): applies to documents added afterwards. Text is cut at paragraph and sentence ends, with a little overlap.
- **Remember older messages**: turns the chat's own memory off while keeping documents.

## Keeping and removing

Stored passages live in the database next to the chats and are part of a backup. Deleting a chat for good, or a character, removes their passages. **Remove** next to a document deletes it. An edited message is not stored again, and there is no button yet to clear one chat's memory short of deleting the chat.

## Limits

Search is a plain similarity ranking, not a reranker, and it is skipped when impersonating. Large collections are compared in memory on the server, which is fine for thousands of passages and not for millions.
