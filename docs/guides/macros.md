# Macros

Anywhere text goes into the prompt (a card's description, personality, scenario and example dialogue, the system prompt, a lorebook entry, an author's note), `{{macros}}` are filled in just before it is sent. They work the way SillyTavern's do, so cards written for it behave the same. An unknown macro is left as written, with any macros inside it filled in.

## Writing them

- `{{name}}`, `{{name::first::second}}` (the arguments), and the older `{{name:value}}` and `{{name value}}` forms.
- Macros nest: `{{getvar::{{char}}_mood}}`.
- Names are not case sensitive.
- A block form for text: `{{trim}} text {{/trim}}`, `{{reverse}}abc{{/reverse}}`, `{{setvar::note}}text{{/setvar}}`, and `{{if x}}...{{else}}...{{/if}}`. Block text is trimmed; start the macro with `#` (`{{#if x}}`) to keep the whitespace.
- `{{// a comment}}` is removed, and `{{//}}` ... `{{///}}` removes everything between.

## Who and what

| Macro | Gives |
| --- | --- |
| `{{char}}`, `{{user}}` | The character's and your persona's names |
| `{{group}}`, `{{notChar}}` | Everyone in a group chat, and everyone except the speaker |
| `{{description}}`, `{{personality}}`, `{{scenario}}`, `{{persona}}` | The card's fields, and your persona text (`charDescription` and the like work too) |
| `{{mesExamples}}`, `{{charPrompt}}`, `{{charInstruction}}`, `{{creatorNotes}}`, `{{charVersion}}`, `{{charDepthPrompt}}` | More card fields |
| `{{greeting}}`, `{{greeting::2}}` | The first message, or an alternate one by number |
| `{{model}}`, `{{maxContext}}`, `{{maxResponse}}`, `{{maxPrompt}}` | The model and token limits |
| `{{systemPrompt}}`, `{{input}}`, `{{lastGenerationType}}` | The system prompt, what is typed in the box, and whether this is a normal, continue or impersonate turn |

## The chat

`{{lastMessage}}`, `{{lastUserMessage}}`, `{{lastCharMessage}}`, `{{lastMessageId}}`, `{{allChatRange}}`, `{{idleDuration}}` (how long since your last message).

## Time

`{{time}}`, `{{date}}`, `{{weekday}}`, `{{isotime}}`, `{{isodate}}`, `{{time::UTC+2}}`, `{{datetimeformat::dddd, MMMM D YYYY [at] h:mm A}}`, `{{timeDiff::2026-10-15T10:00::2026-10-15T08:30}}`.

`datetimeformat` knows `YYYY YY MMMM MMM MM M DD D dddd ddd HH H hh h mm ss A a` and `[escaped text]`.

## Chance

- `{{random::a::b::c}}` (also `{{random:a,b,c}}`) picks again every time. In the fixed part of a card this changes the start of the prompt each turn, so the model's cache is lost; keep it in a place that changes anyway.
- `{{pick::a::b::c}}` picks once and keeps it for that chat and place in the text.
- `{{roll::2d6+3}}`, `{{roll 20}}`.

## Variables

Local variables belong to the chat, global ones are shared. Both are kept in this browser.

- `{{setvar::name::value}}`, `{{getvar::name}}`, `{{addvar::name::5}}` (adds numbers, appends text), `{{incvar::name}}`, `{{decvar::name}}` (return the new value), `{{hasvar::name}}`, `{{deletevar::name}}`.
- The same with `global`: `{{setglobalvar::...}}`, `{{getglobalvar::...}}`.
- `{{setvarkey::name::key::value}}` and `{{getvarkey::name::key}}` for an object or a list.
- Shorthand: `{{.name}}` reads a local variable and `{{$name}}` a global one. `{{.n = 5}}`, `{{.n += 1}}`, `{{.n -= 1}}`, `{{.n++}}`, `{{.n--}}`, `{{.n ?? fallback}}`, `{{.n || fallback}}`, `{{.n ??= value}}`, `{{.n ||= value}}`, and comparisons `== != > >= < <=` that give true or false.

## If

`{{if condition}}text{{/if}}`. The condition can be a macro name (`{{if description}}`), a variable (`{{if .flag}}`), a value, or any of those with `!` in front to flip it. "false", "off", "0" and empty count as false. `{{else}}` gives the other branch, and only the branch taken is worked out.

## World info and templates

- `{{outlet::name}}` places the lorebook entries set to the Outlet position with that name. They stay out of the prompt otherwise.
- `{{instructUserPrefix}}`, `{{instructAssistantSuffix}}`, `{{instructStop}}` and the rest of the `instruct...` family give the markers of the active instruct template.
- `{{banned::word}}` is removed from the text and names a word to ban.
- `{{hasExtension::name}}` is true when an extension by that name is on.

Not included: the filter syntax (`{{name | filter}}`). `{{lastSwipeId}}` and `{{currentSwipeId}}` always say 1, since this app does not number swipes the same way.
