# dsh-edit-in-place

**Edit a message you already sent — in place — and send it again.** The original
conversation stays exactly as it was.

A plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
Read this in [Español](README.es.md).

> There is no screenshot in this README yet. If you install it, send one — it
> deserves to be seen rather than described.

## What it does

Your own messages get a pencil next to the time and the copy button. Press the
pencil, or click the text of the message itself, and the bubble turns into a
text box **in its own place**: nothing opens on top of anything.

```
       HOLAAAA, cambiate esto                 <- your message
       pencil · 20:21 · copy                  <- its action row
                    ↓ press the pencil
 ┌──────────────────────────────────────┐
 │ HOLAAAA, cambiate esto, y ademas...  │     <- same place, now editable
 └──────────────────────────────────────┘
 Se abre una rama: esta conversación no cambia
                        [ Cancelar ] [ Actualizar ]
```

- **Enter** sends, **Shift+Enter** breaks the line, **Escape** cancels.
- A drag or a text selection does **not** start editing: only a clean click does.
- Both buttons are the same size and shape. The filled one borrows its colours
  from the editor's own send button.

## Why a branch, not a rewrite

DeepSeek Harness is an event log: nothing is ever deleted. So "go back and edit"
cannot mean "erase what came after". Instead the plugin asks the Host for a
**branch** cut just before your message, opens it, and sends the corrected text
there.

- Your original conversation is never modified. It stays in the sidebar.
- The branch inherits the whole prefix, then continues with your new text.

This is the honest equivalent of what ChatGPT and Gemini do, and it needs no
patching of the Host, no new endpoints, and no rewriting of logged events.

## Where it cuts the history, with evidence

Measured on real session logs (`tools/eventos.mjs` prints them in order — DSH
writes one zstd frame per appended block, chained inside the same file):

```
turn 1:  ... 2 header | 3 inbox/spliced (your message enters) | 4 turn/start 1 ...
turn N:  ... turn/end N-1 | inbox/spliced (your message enters) | turn/start N ...
```

- **Turn N** → cut at `turn/end` of turn N-1. The prefix ends on a closed turn and
  does **not** drag in the queued message of this one.
- **Turn 1** → cut at `turn/start.seq - 2`, the last session header. Cutting one
  position earlier would swallow the `spliced` event that carries your first
  message, and the old text would be sent again inside the branch.

Confirmed on a live case: editing `TEST` of turn 4 and sending it as
`TEST EDITADO` cut at `turn/end` of turn 3, and the original still reads `TEST`.

## How it sits in the UI

DeepSeek Harness declares no child slots inside the user message bubble, so the
pencil cannot be added with an ordinary extension point. What it does allow is
replacing the renderer of a chat node by key, and the slot catalogue says so in
these words:

> Registering an already-occupied key replaces that occupant.

So the plugin takes the `user` key of `conversation.chat.node` and draws the same
bubble the program drew, with editing built in.

To keep that bubble identical, two things are used at once:

- the program's **own class names** (`MessageItem` module), to inherit its
  stylesheet as-is;
- **class names of this plugin's own, carrying copies of the same CSS rules**, so
  that if the program ever changes its prefix, the bubble still looks right.

Every primitive (`projectUserText`, `FileTypeIcon`, `JsonBlock`, the copy glyph,
`writeClipboard`) is resolved with a fallback: if an export disappears, the
message still renders, and never blank.

## Install

The package declares `dsh.bundle.patch`, so the profile patch is written for you.
**UNVERIFIED:** I could not run `dsh plugin add` on the machine this was built on
(the desktop app has no `dsh` binary on PATH). If it does not work, use option 2.

**1. From GitHub**

```bash
dsh plugin --profile web add github:instak1ll/dsh-edit-in-place
```

Then restart DeepSeek Harness and reload the page.

**2. Manual, always works**

Copy this folder anywhere, then add to
`$DSH_HOME/profiles/<profile>/cordis.patch.yml`:

```yaml
- insert:
    - id: edit-in-place
      name: "C:\\path\\to\\dsh-edit-in-place\\lib\\index.js"
```

Restart DeepSeek Harness. The composition of plugins is built at startup, so a
page reload alone will not pick up a new entry.

**3. As a local dependency**

Put the folder in the profile's dependency tree and use
`name: "dsh-edit-in-place"` in the patch above instead of a path.

## Verify it yourself

```bash
node tools/verificar.mjs
```

35 checks, no browser needed, and not a mock. The script loads the real
`lib/client.js`, runs its `apply()` against a fake client that **imitates
Cordis's prohibitions** (reading a service you did not declare throws), and walks
the real path — bubble, pencil, in-place editing, Enter, Escape, send — calling
the same components React would call. Fixture numbers (4, 8, 218, 220, 375) come
from a real session log.

Two guards read the CSS itself: one fails if the confirm button ever pairs the
brand accent with a white label (it came out invisible on dark themes), the other
fails if it starts changing its shape away from Cancel.

Helpers, useful on their own:

- `tools/asar.mjs` — list, extract and grep inside an Electron `app.asar` with
  nothing installed: `node tools/asar.mjs grep <archive> <needle>`
- `tools/eventos.mjs` — print a session log's events in order:
  `node tools/eventos.mjs <session.v4.jsonl.zstd> --skeleton`

## Limitations, plainly

- **Always a branch.** No branch, no feature: DSH never deletes logged events.
- **Only the message that opened a turn.** A mid-turn steering message keeps the
  program's renderer and has no pencil.
- **Text only.** Attachments of the original message are not carried into the
  branch.
- **The reference line is ours.** When a message uses `@file` mentions, the bubble
  says `Referencias: …` instead of the program's wording.
- **It replaces the official user renderer.** If DeepSeek changes the shape of
  that node, the bubble may lag behind until this plugin is updated. The fallback
  classes blunt it, they do not remove it.
- **Tested against DeepSeek Harness 0.2.0-rc.2** (desktop). Older or newer builds
  are untested.

## Related work

Three other plugins touch the same idea, and this one is not the first:

- [dsh-edit-message](https://github.com/2648782102/dsh-edit-message) — edit and
  resend one of your own messages, even while the agent is replying.
- [dsh-msg-edit](https://github.com/moton16/dsh-msg-edit) — edits by appending
  `surface-replace` events to the log, with host RPC endpoints. Its own README
  places **inline editing of the user message out of scope**, on the grounds that
  the user renderer slot is owned by the official UI, and documents three host
  behaviours it has to work around.
- `dsh-edit-resend` on npm.

The difference here is narrow and deliberate: **nothing in the log is rewritten
and nothing is patched**, the edit happens inside your own bubble, and the
original stays readable.

## License

MIT © Артём Гладков ([instak1ll](https://github.com/instak1ll))
