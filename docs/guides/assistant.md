# The Assistant: tools, files, pictures and memory

The Assistant is the plain chat in the sidebar (not a character). With **Tools** switched on it can look things up, read and edit files in one folder you choose, look at pictures, and make new ones. Everything that changes something asks first.

## Tools: Off, Look, Look and change

The switch above the message box:

| Mode | What the Assistant can do |
| --- | --- |
| Off | Talk only. |
| Look | Read your library, the workspace folder and web pages. Nothing is changed. |
| Look and change | Also create and edit library items and workspace files, and save pictures. |

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
