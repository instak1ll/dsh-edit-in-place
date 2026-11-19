# dsh-edit-in-place

**Edit a message you already sent — in place — and send it again.** The original
conversation stays exactly as it was.

A plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

## What it does

Your own messages get a pencil next to the clock and the copy button. Press the
pencil, or click the text of the message itself, and the bubble turns into a text
box **in its own place**: nothing opens on top of anything.

```
        Let's change this sentence            <- your message
        pencil · 20:21 · copy                 <- its action row
                    ↓ press the pencil
 ┌──────────────────────────────────────┐
 │ Let's change this sentence, and also… │     <- same place, now editable
 └──────────────────────────────────────┘
 Opens a new branch: this conversation stays unchanged
                        [ Cancel ] [ Update ]
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

For a message that opened a turn, nothing is needed beyond the client: the cut is
already in the snapshot. For a message sent while the answer was running, the
browser cannot see where it entered, so the Host reads the session log and answers
one read-only lookup. Nothing is patched, no logged event is rewritten, and the
lookup only ever reads.

## Where it cuts the history, with evidence

Measured on real session logs (`tools/eventos.mjs` prints them in order: DSH
writes one zstd frame per appended block, chained inside the same file).

```
turn 1:  ... 2 header | 3 inbox/spliced (your message enters) | 4 turn/start 1 ...
turn N:  ... turn/end N-1 | inbox/spliced (your message enters) | turn/start N ...
```

- **Turn N** cuts at the `turn/end` of turn N-1. The prefix ends on a closed turn
  and does **not** drag in the queued message of this one.
- **Turn 1** cuts at `turn/start.seq - 2`, the last session header. Cutting one
  position earlier would swallow the `spliced` event that carries your first
  message, and the old text would be sent again inside the branch.

Confirmed on a live case: editing `TEST` of turn 4 and sending it as
`TEST EDITED` cut at the `turn/end` of turn 3, and the original still reads
`TEST`.

A message sent **while the answer is running** is a different shape, and the
messy part is that the copy the client can see arrives last:

```
1351  agent/inbox/spliced next-turn  empty
1352  agent/inbox/spliced next-step  <- the message enters HERE
1354  assistant/message
1358  tool/result
1362  user/message                   <- the copy the client can see
```

Anything the browser can infer falls after 1352, so a branch cut there would carry
the original text in its queue and send it again. The log knows the exact position,
so the browser asks the Host, which reads the session log, walks back to the
`agent/inbox/spliced` that carried that message and returns the event before it.
Measured on that same session: message 1362 cuts at 1351, message 1258 cuts at 1252.

## How it sits in the UI

DeepSeek Harness declares no child slots inside the user message bubble, so the
pencil cannot be added through an ordinary extension point. What it does allow is
replacing the renderer of a chat node by key — but the catalogue's wording
("registering an already-occupied key replaces that occupant") is only half the
rule, and the missing half costs an afternoon:

> keyed slot "conversation.chat.node" already has an entry for key "user" at
> priority 0 (registered by mf) — register at a different priority to shadow it
> (lowest renders)

So a shadow has to sit **under** the program's priority, not beside it: entries
are sorted ascending by priority and the first live entry wins. This plugin
registers **two** keys at `priority: -1` — `user` for a message that opened a
turn, and `steering` for one sent while the answer was running — and draws the
same bubble the program drew, with editing built in.

Registering at the default 0 does not fail loudly: it fails **later**, on the
first repaint, when the registration is rebuilt and the collision throws. The
pencil then disappears and the program's renderer comes back, which looks exactly
like a random bug.

To keep that bubble identical, two things are used at once:

- the program's **own class names** (the `MessageItem` module), to inherit its
  stylesheet as-is;
- **class names of this plugin's own, carrying copies of the same CSS rules**, so
  that if the program ever changes its prefix, the bubble still looks right.

Every primitive (`projectUserText`, `FileTypeIcon`, `JsonBlock`, the copy glyph,
`writeClipboard`) is resolved with a fallback: if an export disappears, the
message still renders, and never blank.

## Install

The package declares `dsh.bundle.patch`, so the profile patch is meant to be
written for you. **UNVERIFIED:** `dsh plugin add` could not be run on the machine
this was built on (the desktop app ships no `dsh` binary on `PATH`). If it does
not work, use option 2.

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

Restart DeepSeek Harness. The plugin composition is built at startup, so a page
reload alone will not pick up a new entry.

**3. As a local dependency**

Put the folder in the profile's dependency tree and use
`name: "dsh-edit-in-place"` in the patch above instead of a path.

## Verify it yourself

```bash
node tools/verificar.mjs
```

41 checks, no browser needed, and not a mock. The script loads the real
`lib/client.js`, runs its `apply()` against a fake client that **imitates
Cordis's prohibitions** (reading a service you did not declare throws), and walks
the real path — bubble, pencil, in-place editing, Enter, Escape, send — calling
the same components React would call. The fixture numbers (4, 8, 218, 220, 375)
come from a real session log.

Two of the checks read the CSS itself: one fails if the confirm button ever pairs
the brand accent with a white label (it came out invisible on dark themes), the
other fails if it starts changing its shape away from Cancel.

Helpers, useful on their own:

- `tools/asar.mjs` — list, extract and search inside an Electron `app.asar` with
  nothing installed: `node tools/asar.mjs grep <archive> <needle>`
- `tools/eventos.mjs` — print a session log's events in order:
  `node tools/eventos.mjs <session.v4.jsonl.zstd> --skeleton`

## Language

Every string this plugin shows has an English and a Spanish form. The choice is
made per reader, not per repository:

1. an explicit choice, stored under `localStorage["dsh-edit-in-place:language"]` (`en` or `es`)
2. otherwise, the reader's own language (`navigator.language`)
3. otherwise, the harness locale, when it is one of those two
4. otherwise, English

The reader comes before the harness on purpose: the application can be in English
while the person using it is not, and these strings belong to the message, not to
the program's chrome.

## Limitations, plainly

- **Always a branch.** No branch, no feature: DSH never deletes logged events.
- **Mid-turn messages need the Host route.** A message sent while the answer is
  running enters the turn through a queue event the browser never receives. The
  plugin asks the Host, which reads the log and returns the position. If that route
  is unreachable, those messages keep their pencil and it says so, instead of
  cutting in the wrong place and sending the old text twice.
- **Text only.** Attachments of the original message are not carried into the
  branch.
- **The reference line is ours.** When a message uses `@file` mentions, the bubble
  reads `References: …` instead of the program's wording.
- **It replaces the official user renderer.** If DeepSeek changes the shape of
  that node, the bubble may lag behind until this plugin is updated. The fallback
  classes blunt it, they do not remove it.
- **Tested against DeepSeek Harness 0.2.0-rc.2** (desktop). Older or newer builds
  are untested.

## License

MIT © Артём Гладков ([instak1ll](https://github.com/instak1ll))
