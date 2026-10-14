# The Assistant: tools, files, pictures and memory

The Assistant is the plain chat in the sidebar (not a character). With **Tools** switched on it can look things up, read and edit files in one folder you choose, look at pictures, and make new ones. Everything that changes something asks first.

## Tools: Off, Look, Look and change

The switch above the message box:

| Mode | What the Assistant can do |
| --- | --- |
| Off | Talk only. |
| Look | Read your library, the workspace folder and web pages. Nothing is changed. |
| Look and change | Also create and edit library items and workspace files, and save pictures. |

## Making a character

Ask in plain words ("create a quiet night-shift librarian with a dry sense of humor and a secret"). The Assistant drafts the character one section at a time and shows a card. Nothing is saved until you click **Save to characters**.

- **What it writes:** the core card (description, personality, scenario, first message, example dialogue), alternate greetings, life and background, gift tastes and relationship starters, connections and behavioral rules, voice, gift scores, schedule, birthday and how often they text first, wardrobe names, and a character lorebook.
- **Review:** each section is a collapsible block on the card. **Redo this section** writes one again without touching the rest. A section that failed says so, and can be written the same way.
- **Boundaries:** when the brief or the card gives an age under 18, or describes a child or schoolchild, the intimacy settings are left blank (the card says why) and the wardrobe gets no undressed state. Hard limits and off-limit regions are only ever copied from what you wrote in the brief or the character's boundaries, never chosen by the model. The persona engine is drafted but stays switched off.
- **Not filled in yet:** the voice provider and speaker, system prompt overrides, and all art. Open the saved character in the editor for those.
- **Not a character request?** When your message looks like one, a strip above the message box offers **Send as plain chat**. **Settings, Agents, Building characters** turns the automatic build off; you then get a button instead.
- The character editor's **Generate with AI** runs the same steps and fills the form for you to review.
- Each section is its own model call, so a full character takes a few minutes on a local model. **Stop** cancels it.

### Drafting and editing through tools

With Tools on, the model can also call `build_character` itself (it only drafts: the same review card appears, nothing is saved) and, in **Look and change**, `edit_character_section`. That tool rewrites one section of a saved character from an instruction (voice, schedule, gift scores, wardrobe and so on; the core card text is changed with `update_character`). It shows the section before and after and asks first, unless auto-approve is on. Every change leaves a **Revert** button in the thread that puts that section back as it was. A rewritten persona-engine section keeps your on/off switch and your impulse lists.

`update_character` and `create_character` also take birthday, gift likes and dislikes, weather loves and hates, reply length, outreach frequency and sound words. External MCP clients (the port 3002 server) additionally see the nested sections with full schemas: schedule, connections, rules, voice fingerprint, gift scores, touch and kink profiles, and persona settings. The Assistant's own tool list leaves those out because a small local model cannot fill nested JSON from a plain-text call. Intimacy settings are refused for a card that describes someone under 18, and the persona engine is never switched on from a tool.

An open character editor remembers the version it loaded. If the Assistant or an MCP client changed the character since, **Save** asks before it overwrites those changes.

## The workspace folder

Pick a folder in **Settings, Agents, Assistant workspace**. The Assistant can then list, read, search and (in Look and change) edit, write, create and move files inside it.

- It cannot leave the folder, follow a link out of it, touch `.git`, or delete anything.
- Hakoniwa's own data folder cannot be chosen, and is blocked even when a workspace contains it.
- Every edit shows the exact change (`- old` / `+ new`) and waits for you. **Apply file edits without asking** turns that off for edits only.
- **Let it run commands** is off by default. When on, each command still asks first, with the command shown, and is stopped after 30 seconds unless the Assistant asks for longer (2 minutes at most).
- Web pages (`fetch_url`) are read as text; addresses on your own machine or network are refused.

## Pictures

- **Seeing:** attach or paste a picture into the message box (the paperclip). It is shrunk to at most 1024 pixels and sent to the model, so the model must support vision (KoboldCpp with an `--mmproj`, or a vision-capable hosted model). Files the Assistant reads from the workspace can come back as pictures too (`view_image`).
- **Making:** if an image backend is set up in Settings, Images, the Assistant can make a picture, look at the result, and (with your approval) save it into the workspace. Hosted backends that bill you ask before every picture.

## Memory and long conversations

- **Notes:** the Assistant can save short, lasting facts ("I prefer tea") and uses them in later conversations. See, add and delete them in Settings, Agents, Assistant memory.
- **Long threads:** when old turns no longer fit the model's context, they are folded into a running summary instead of being dropped.
- It always knows the date and time, and the name of its workspace folder.

## Image backends

### ComfyUI

Settings, Images, ComfyUI. Hakoniwa talks to ComfyUI through its own server, so ComfyUI needs no special launch flags (browsers cannot call it directly because it sends no CORS headers).

1. Enter the address (default `http://127.0.0.1:8188`) and press **Check connection**. The dropdowns below fill in from your install.
2. Choose a **workflow**:
   - **Checkpoint:** one model file (Stable Diffusion 1.5, SDXL and similar).
   - **Separate models:** diffusion model, text encoder and VAE as separate files, for newer models.
   - **My workflow:** paste a workflow exported with **Save (API format)**. Put `{{prompt}}`, `{{negative}}`, `{{seed}}`, `{{width}}`, `{{height}}`, `{{steps}}`, `{{cfg}}`, `{{sampler}}`, `{{model}}` where values belong, or leave them out and Hakoniwa fills the usual nodes (text encoders, sampler, empty latent) automatically.
3. Optionally add LoRAs, which are applied to every picture.

If a workflow is rejected, the message names the node and input that ComfyUI objected to.

### NovelAI

Text (Erato) and images share the same account, but the key is stored separately for each.

- **Text:** Settings, Connection, Model source: NovelAI. Stop sequences are applied by Hakoniwa, since Erato has no stop list.
- **Images:** Settings, Images, NovelAI. Models V4 and V4.5 use NovelAI's structured prompt format.
- Requests go through Hakoniwa's server (browsers cannot call NovelAI directly), which forwards them without storing the key.
- This was written from the public API documentation and tested against mock servers only, not a live subscription. Report anything odd.
