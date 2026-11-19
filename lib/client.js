/**
 * Edit a message you already sent, in place, and send it again.
 *
 * HOW EDITING WORKS
 * In place. There is no dialog on top: pressing the pencil, or clicking the text
 * of the message when nothing is selected, turns the bubble into a text box in
 * its own place, with Cancel and Update underneath. Enter sends, Shift+Enter
 * breaks the line, Escape cancels.
 *
 * WHERE THE PENCIL LIVES
 * In YOUR message. DSH declares no child slots inside the user message bubble,
 * but the catalogue of the `conversation.chat.node` slot states: "Registering an
 * already-occupied key replaces that occupant". So this plugin takes the `user`
 * key and draws the same bubble the program drew, with editing built in.
 *
 * WHY IT DOES NOT LOOK DIFFERENT
 * The program's own class names (the MessageItem module) and this plugin's own
 * names carrying copies of the same CSS rules are used together: if the program
 * ever changes its prefix, the copies keep the bubble styled. Every primitive is
 * resolved with a fallback, so a missing export can never leave the message blank.
 *
 * WHAT SENDING DOES
 * It does not rewrite history (DSH is an event log and nothing is ever deleted):
 * it asks the Host for a BRANCH cut before that message, opens it and sends the
 * corrected text there. The original conversation is left untouched.
 *
 * WHERE IT CUTS, WITH EVIDENCE
 * Probe of real session logs with `tools/eventos.mjs`:
 *
 *   turn 1:  ... 2 header | 3 inbox/spliced (your message enters) | 4 turn/start 1 ...
 *   turn N:  ... turn/end N-1 | inbox/spliced (your message enters) | turn/start N ...
 *
 * The cut for turn N is the `turn/end` of turn N-1: the prefix ends on a closed
 * turn and does not drag in the queued message of this one. The first turn cuts
 * two positions before its `turn/start`, which is the last session header.
 *
 * Validated on a live case: editing `TEST` of turn 4 and sending it as
 * `TEST EDITADO` cut at `turn/end` of turn 3 and left the original intact.
 */

window.__ModuleLoader__.load({
	id: 'dsh-edit-in-place',
	factory: (require) => {
		const module = { exports: {} };
		const exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
		const react = require('react');
		const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
		//#region dsh-edit-in-place/EditInPlace.module.css
		const css = `
/* User bubble: literal copy of the program's rules, under names of our own so we
   do not depend on its prefix. The values are the program's, not invented. */
.dshem_userRow{flex-direction:column;align-items:flex-end;gap:6px;display:flex}
.dshem_userStack{min-width:0;max-width:min(calc(var(--dsh-chat-content-width,748px) * .702), 82%);flex-direction:column;align-items:flex-end;gap:8px;display:flex}
.dshem_bubble{background:var(--dsw-specific-bubble);border-radius:var(--dsw-radius-xl);max-width:100%;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;padding:10px 16px}
.dshem_referenceSummary{color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(18px + var(--dsh-content-font-delta-secondary,0px))}
.dshem_attachmentRow{flex-wrap:wrap;justify-content:flex-end;gap:8px;max-width:100%;display:flex}
.dshem_fileCard{border:.5px solid var(--dsw-alias-border-l2,#0000001f);border-radius:var(--dsw-radius-xl);background:var(--dsw-specific-input-major,transparent);box-sizing:border-box;flex:0 0 240px;align-items:center;gap:10px;width:240px;min-height:64px;padding:8px 12px;display:inline-flex}
.dshem_fileContent{flex-direction:column;flex:1;min-width:0;display:flex}
.dshem_fileIcon{flex:none;width:28px;height:28px}
.dshem_fileName{white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px;overflow:hidden}
.dshem_fileMeta{white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-tertiary,#00000073);font-size:12px;line-height:15px;overflow:hidden}
/* Action row: the program's measurements, with the pencil in front. */
.dshem_uactions{height:calc(28px + var(--dsh-content-font-delta,0px));align-items:center;gap:8px;display:flex;justify-content:flex-end}
.dshem_uaction{width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));border-radius:var(--dsw-radius-sm,6px);color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;justify-content:center;align-items:center;padding:6px;display:inline-flex}
.dshem_uaction svg{width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px))}
.dshem_uaction:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));color:var(--dsw-alias-label-secondary)}
.dshem_uaction:disabled{opacity:.45;cursor:default}
.dshem_uaction:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dshem_utime{font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);white-space:nowrap}
/* In-place editing: the bubble becomes a text box, and the box takes the width of
   the column (not the narrow width of the bubble). */
.dshem_editWrap{width:100%;display:flex;flex-direction:column;gap:8px}
.dshem_editBox{display:block;width:100%;box-sizing:border-box;min-height:64px;max-height:44vh;resize:vertical;background:var(--dsw-specific-bubble);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xl);color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));padding:10px 16px;white-space:pre-wrap;word-break:break-word}
.dshem_editBox:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dshem_editRow{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;max-width:100%}
.dshem_editNote{margin-right:auto;font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-tertiary)}
.dshem_editError{margin:0;font-size:12.5px;line-height:1.45;color:var(--dsw-alias-state-error-primary);white-space:pre-wrap;text-align:right}
/* Both buttons share this box: same height, same minimum width, same radius and
   the same 1px border, transparent on the filled one so nothing shifts. */
.dshem_small{padding:5px 12px;min-width:118px;text-align:center;box-sizing:border-box;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.dshem_small:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}
.dshem_small:disabled{opacity:.5;cursor:default}
.dshem_small:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
/* The confirm button copies the program's own filled-button pair: on the brand
   accent the white label became invisible on dark themes. */
.dshem_send{background:var(--dsw-alias-button-info-fill,#3b6fd4);border-color:transparent;color:#fff;font-weight:500}
.dshem_send:hover:not(:disabled){background:var(--dsw-alias-button-info-hover,var(--dsw-alias-button-info-fill,#3b6fd4));filter:none}
`;
		const tagId = 'dsh-edit-in-place/EditInPlace.module.css';
		if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
			const tag = document.createElement('style');
			tag.dataset.plugin = 'dsh-edit-in-place';
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		/** The program's class names, to inherit its stylesheet as-is. */
		const SHIPPED = {
			userRow: 'cJsG2q_userRow',
			userStack: 'cJsG2q_userStack',
			bubble: 'cJsG2q_bubble',
			referenceSummary: 'cJsG2q_referenceSummary',
			attachmentRow: 'cJsG2q_attachmentRow',
			fileCard: 'cJsG2q_fileCard',
			fileContent: 'cJsG2q_fileContent',
			fileIcon: 'cJsG2q_fileIcon',
			fileName: 'cJsG2q_fileName',
			fileMeta: 'cJsG2q_fileMeta',
		};
		/** Our own names, with the same rules, so the prefix above is not a dependency. */
		const MINE = {
			userRow: 'dshem_userRow',
			userStack: 'dshem_userStack',
			bubble: 'dshem_bubble',
			referenceSummary: 'dshem_referenceSummary',
			attachmentRow: 'dshem_attachmentRow',
			fileCard: 'dshem_fileCard',
			fileContent: 'dshem_fileContent',
			fileIcon: 'dshem_fileIcon',
			fileName: 'dshem_fileName',
			fileMeta: 'dshem_fileMeta',
		};

		/**
		 * Both class names at once: the program's copy and ours.
		 * @param key - logical class name.
		 * @returns the class list, space separated.
		 */
		function both(key) {
			return SHIPPED[key] + ' ' + MINE[key];
		}

		/**
		 * Visible text. English is the default and the only language the README
		 * promises. Spanish is a translation for a harness running in Spanish, so the
		 * same code serves both without a second fork.
		 */
		const STRINGS = {
			en: {
				edit: 'Edit and resend this message',
				noText: 'This message has no text to edit',
				noBranch: 'No clean point to branch from this message',
				steer: 'Sent while the answer was running: it cannot be branched from yet',
				resolve: 'Finding a clean point to cut…',
				noHost: 'the Host is not answering the cut lookup',
				clickToEdit: 'Click to edit this message',
				copy: 'Copy',
				copied: 'Copied',
				copyMessage: 'Copy message',
				references: 'References:',
				extraBlock: 'Extra block',
				truncated: 'truncated',
				note: 'Opens a new branch: this conversation stays unchanged',
				cancel: 'Cancel',
				update: 'Update',
				updating: 'Updating…',
				keys: 'Enter updates · Shift+Enter adds a line · Esc cancels',
				yourMessage: 'Your message',
				noSessions: 'the sessions service is not available',
				noConversation: 'no conversation to edit from',
				noCut: 'no clean point to cut the conversation',
				empty: 'the message is empty',
				noChild: 'the Host did not return the new branch',
				branchUnopened: 'the branch was created but could not be opened',
				branchSlow: 'the branch took too long to open, try again',
				rejected: 'the Host rejected the message',
				noClient: 'the plugin is not connected to the client',
			},
			es: {
				edit: 'Editar y reenviar este mensaje',
				noText: 'Este mensaje no tiene texto que editar',
				noBranch: 'No hay un punto limpio donde ramificar desde este mensaje',
				steer: 'Enviado mientras respondía: todavía no se puede ramificar desde aquí',
				resolve: 'Buscando un punto limpio donde cortar…',
				noHost: 'el Host no responde a la búsqueda del corte',
				clickToEdit: 'Pulsa para editar este mensaje',
				copy: 'Copiar',
				copied: 'Copiado',
				copyMessage: 'Copiar el mensaje',
				references: 'Referencias:',
				extraBlock: 'Bloque extra',
				truncated: 'recortado',
				note: 'Se abre una rama: esta conversación no cambia',
				cancel: 'Cancelar',
				update: 'Actualizar',
				updating: 'Actualizando…',
				keys: 'Enter actualiza · Mayús+Enter salta de línea · Esc cancela',
				yourMessage: 'Tu mensaje',
				noSessions: 'el servicio de sesiones no está disponible',
				noConversation: 'no se sabe de qué conversación editar',
				noCut: 'no hay un punto limpio donde cortar la conversación',
				empty: 'el mensaje está vacío',
				noChild: 'el Host no devolvió la rama nueva',
				branchUnopened: 'la rama se creó pero no se pudo abrir',
				branchSlow: 'la rama tardó demasiado en abrirse, inténtalo otra vez',
				rejected: 'el Host rechazó el mensaje',
				noClient: 'el plugin no está conectado al cliente',
			},
		};

		/** Language of this session: English unless the harness says Spanish. */
		let language = 'en';

		/**
		 * One visible string in the current language.
		 * @param key - entry of {@link STRINGS}.
		 * @returns the text, falling back to English.
		 */
		function t(key) {
			const table = STRINGS[language] ?? STRINGS.en;
			return table[key] ?? STRINGS.en[key] ?? key;
		}

		/** Where a person can pin the language by hand, whatever their system says. */
		const LANGUAGE_KEY = 'dsh-edit-in-place:language';

		/**
		 * Map a locale tag onto a language this plugin speaks.
		 * @param value - something like "es", "es-ES", "en-GB".
		 * @returns "es", "en", or null when it is neither.
		 */
		function chooseLanguage(value) {
			if (typeof value !== 'string' || value === '') return null;
			const tag = value.toLowerCase();
			if (tag.startsWith('es')) return 'es';
			if (tag.startsWith('en')) return 'en';
			return null;
		}

		/**
		 * Decide the language, in this order:
		 *
		 *   1. an explicit choice in localStorage, under LANGUAGE_KEY
		 *   2. the reader's own language, navigator.language
		 *   3. the harness locale, when it speaks one of ours
		 *   4. English
		 *
		 * The reader comes before the harness on purpose: the application can be in
		 * English while the person using it is not, and these strings belong to the
		 * message, not to the program's chrome.
		 * @param locale - the client locale service, when the composition has one.
		 */
		function followLocale(locale) {
			const read = () => {
				let picked = null;
				try {
					picked = chooseLanguage(globalThis.localStorage?.getItem(LANGUAGE_KEY));
				} catch {
					/* storage can be denied, and that is not a failure */
				}
				if (picked === null) picked = chooseLanguage(globalThis.navigator?.language);
				if (picked === null) {
					try {
						const snapshot = locale?.getLocale?.() ?? locale?.getSnapshot?.();
						picked = chooseLanguage(snapshot?.id ?? snapshot?.locale);
					} catch {
						picked = null;
					}
				}
				language = picked ?? 'en';
			};
			read();
			try {
				if (typeof locale?.subscribe === 'function') locale.subscribe(read);
			} catch {
				/* following the locale is a nicety, not a requirement */
			}
		}

		/** How long to wait for the new branch to open before giving up. */
		const OPEN_TIMEOUT_MS = 20000;
		/** How often to poll the branch binding while waiting. */
		const OPEN_POLL_MS = 120;
		/** Pixels of drag that are no longer a click, so selecting never edits. */
		const DRAG_TOLERANCE = 4;

		/**
		 * Open a session in the main view. Filled in when the client has
		 * `uiWorkspace`, which is optional: without it the branch is still created.
		 */
		let navigateTo = null;

		/**
		 * Read a service without breaking when it was not injected. Cordis throws
		 * "cannot get property ... without inject" when you touch one you did not
		 * declare, so this probes and returns undefined instead of throwing.
		 * @returns the service, or undefined.
		 */
		function serviceOf(ctx, key) {
			if (ctx === null || ctx === undefined) return undefined;
			try {
				const direct = ctx[key];
				if (direct !== undefined && direct !== null) return direct;
			} catch {
				/* not injected: fall through to ctx.get */
			}
			try {
				return ctx.get?.(key);
			} catch {
				return undefined;
			}
		}

		/**
		 * Split a message body the way the program does.
		 * @param content - message blocks.
		 * @returns text, attachments and unknown blocks.
		 */
		function contentParts(content) {
			const texts = [];
			const attachments = [];
			const rest = [];
			if (!Array.isArray(content)) return { text: '', attachments, rest };
			for (const block of content) {
				if (block === null || typeof block !== 'object') continue;
				if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text);
				else if (block.type === 'image' && block.attachment !== undefined) attachments.push({ type: 'image', image: { attachment: block.attachment } });
				else if (block.type === 'file' && block.attachment !== undefined) attachments.push({ type: 'file', file: block.attachment });
				else rest.push(block);
			}
			return { text: texts.join(''), attachments, rest };
		}

		/**
		 * The turn's `start.seq`, looked up on the turn and on its location.
		 * @returns the seq, or undefined.
		 */
		function startSeqOf(...candidates) {
			for (const candidate of candidates) {
				const seq = candidate?.start?.seq;
				if (typeof seq === 'number' && Number.isFinite(seq)) return seq;
			}
			return undefined;
		}

		/**
		 * The turn's `end.seq`, which is a real `turn/end` in the log.
		 * @returns the seq, or undefined.
		 */
		function endSeqOf(turn) {
			const seq = turn?.end?.seq;
			return typeof seq === 'number' && Number.isFinite(seq) ? seq : undefined;
		}

		/**
		 * A snapshot collection that behaves like a Map without demanding its prototype.
		 * @returns the collection, or null.
		 */
		function asMap(value) {
			if (value === null || typeof value !== 'object') return null;
			if (typeof value.get !== 'function' || typeof value.values !== 'function') return null;
			return value;
		}

		/**
		 * Place a message's turn in the history and decide where to cut.
		 * @param snapshot - chat snapshot (`useChat`).
		 * @param turnLocation - the message's `node.location.turn`.
		 * @param seq - the message's `node.data.seq`.
		 * @returns the turn number and the cut, or null.
		 */
		function locateTurn(snapshot, turnLocation, seq) {
			try {
				const timeline = snapshot?.timeline;
				const turns = asMap(timeline?.turns);
				const order = Array.isArray(timeline?.turnOrder) ? timeline.turnOrder : null;
				if (turns === null || order === null || order.length === 0) return null;
				let number = null;
				const declared = turnLocation?.turn;
				if (typeof declared === 'number' && turns.get(declared) !== undefined) number = declared;
				if (number === null) {
					for (const candidate of order) {
						if (turns.get(candidate) === turnLocation) {
							number = candidate;
							break;
						}
					}
				}
				if (number === null && typeof seq === 'number') {
					for (const candidate of order) {
						if (endSeqOf(turns.get(candidate)) === seq) {
							number = candidate;
							break;
						}
					}
				}
				if (number === null) return null;
				const turn = turns.get(number);
				const position = order.indexOf(number);
				const previous = position > 0 ? turns.get(order[position - 1]) : undefined;
				const previousEnd = endSeqOf(previous);
				const startSeq = startSeqOf(turn, turnLocation);
				let atSeq = null;
				if (previousEnd !== undefined) atSeq = previousEnd;
				// First turn: its message enters on the `spliced` event at `start.seq - 1`,
				// so the last clean cut is `start.seq - 2`, a session header.
				else if (startSeq !== undefined && startSeq >= 2) atSeq = startSeq - 2;
				return { number, turn, previousNumber: position > 0 ? order[position - 1] : null, atSeq, first: previous === undefined };
			} catch {
				return null;
			}
		}

		/**
		 * Last resort for the turn start: look for the turn whose own user node
		 * carries this exact event seq. It covers a message whose location has not
		 * been projected yet, which is the state of one that was just sent.
		 * @param snapshot - chat snapshot.
		 * @param seq - the message's own event seq.
		 * @returns the turn's start seq, or undefined.
		 */
		function startSeqFromOwner(snapshot, seq) {
			try {
				if (typeof seq !== 'number') return undefined;
				const turns = asMap(snapshot?.timeline?.turns);
				const order = Array.isArray(snapshot?.timeline?.turnOrder) ? snapshot.timeline.turnOrder : null;
				if (turns === null || order === null) return undefined;
				for (const number of order) {
					const turn = turns.get(number);
					const own = asMap(turn?.data);
					const mine = own === null ? undefined : own.get('user');
					if (mine?.data?.seq === seq) return startSeqOf(turn);
				}
			} catch {
				return undefined;
			}
			return undefined;
		}

		/**
		 * Stable selector for the branch cut.
		 * @returns the cut seq, or null.
		 */
		function selectBoundary(snapshot, turnLocation, seq) {
			const located = locateTurn(snapshot, turnLocation, seq);
			// One rule for every turn, taken from the message's own turn: the message
			// enters on the `spliced` event at `turn/start.seq - 1`, so
			// `turn/start.seq - 2` is the last clean cut. For turn N that is the
			// `turn/end` of turn N-1, and for turn 1 it is a session header.
			//
			// It does NOT depend on the previous turn, which is what used to disable the
			// pencil on the newest message: while that turn is still running, its
			// predecessor's closing sequence is not in the snapshot yet.
			let startSeq = startSeqOf(turnLocation, located === null ? undefined : located.turn);
			if (startSeq === undefined) startSeq = startSeqFromOwner(snapshot, seq);
			if (startSeq !== undefined && startSeq >= 2) return startSeq - 2;
			return located === null ? null : located.atSeq;
		}

		/**
		 * Wait without blocking the thread.
		 * @returns a promise that settles when the delay is over.
		 */
		function sleep(ms) {
			return new Promise((resolve) => setTimeout(resolve, ms));
		}

		/**
		 * A binding's open state, without trusting its shape.
		 * @returns the state as a string.
		 */
		function openStateOf(binding) {
			try {
				const state = binding?.session?.getSnapshot?.()?.openState;
				return typeof state === 'string' ? state : 'unknown';
			} catch {
				return 'unknown';
			}
		}

		/**
		 * Wait for the branch to open and return its live binding.
		 * @param sessions - the client `sessions` service.
		 * @param sessionId - the branch id.
		 * @param budgetMs - how long to wait.
		 * @returns the binding, ready to take a message.
		 */
		async function waitForBinding(sessions, sessionId, budgetMs) {
			const until = Date.now() + budgetMs;
			for (;;) {
				let binding;
				try {
					binding = sessions.binding(sessionId);
				} catch {
					binding = undefined;
				}
				if (binding !== undefined) {
					const state = openStateOf(binding);
					if (state === 'open') return binding;
					if (state === 'error') throw new Error(t('branchUnopened'));
				}
				if (Date.now() >= until) {
					if (binding !== undefined) return binding;
					throw new Error(t('branchSlow'));
				}
				await sleep(OPEN_POLL_MS);
			}
		}

		/**
		 * Create the branch and send the corrected text there.
		 * @param ctx - the client context (owner of `sessions` and `uiWorkspace`).
		 * @param options - source session, exact cut and new text.
		 * @returns the new branch id.
		 */
		async function resendInFork(ctx, options) {
			const sessions = serviceOf(ctx, 'sessions');
			if (sessions === undefined || typeof sessions.fork !== 'function') {
				throw new Error(t('noSessions'));
			}
			const sessionId = options.sessionId;
			const atSeq = options.atSeq;
			const text = String(options.text ?? '').trim();
			if (typeof sessionId !== 'string' || sessionId === '') throw new Error(t('noConversation'));
			if (typeof atSeq !== 'number' || !Number.isFinite(atSeq) || atSeq < 0) throw new Error(t('noCut'));
			if (text === '') throw new Error(t('empty'));
			const childId = await sessions.fork({ sessionId, atSeq, increaseTitle: true });
			if (typeof childId !== 'string' || childId === '') throw new Error(t('noChild'));
			const navigate = typeof options.navigate === 'function' ? options.navigate : navigateTo;
			if (typeof navigate === 'function') {
				try {
					navigate(childId);
				} catch {
					/* the branch exists even if the view does not jump */
				}
			}
			const binding = await waitForBinding(sessions, childId, options.timeoutMs ?? OPEN_TIMEOUT_MS);
			const result = await binding.session.prompt([{ type: 'text', text }], 'queue');
			if (result === null || typeof result !== 'object' || result.ok !== true) {
				const detail = result?.error?.message;
				throw new Error(typeof detail === 'string' && detail !== '' ? detail : t('rejected'));
			}
			return childId;
		}

		/** Ports tried for the cut lookup, in order, after the page origin. */
		const CUT_PORTS = [19387, 19388, 19386, 8080];

		/** Where the Host answered the help probe, once it has. */
		let cutBase;

		/**
		 * Find the Host that serves the cut route: the page origin when it is HTTP, then
		 * a few loopback ports. The desktop app is not served over HTTP, so the ports
		 * matter.
		 * @returns the base URL, or null.
		 */
		async function hostBase() {
			if (cutBase !== undefined) return cutBase;
			const candidates = [];
			try {
				if (typeof location !== 'undefined' && typeof location.origin === 'string') candidates.push(location.origin);
			} catch {
				/* no location, only ports */
			}
			for (const port of CUT_PORTS) candidates.push('http://127.0.0.1:' + port);
			for (const candidate of candidates) {
				try {
					// A probe without a deadline can hang the pencil on a scheme that never
					// answers. One second each, and the loop is short.
					const controller = typeof AbortController === 'function' ? new AbortController() : null;
					const timer = controller === null ? null : setTimeout(() => controller.abort(), 1200);
					const response = await fetch(candidate + '/dsh-edit-in-place/health', {
						method: 'GET',
						signal: controller === null ? undefined : controller.signal,
					});
					if (timer !== null) clearTimeout(timer);
					if (response.ok) {
						cutBase = candidate;
						return cutBase;
					}
				} catch {
					/* try the next candidate */
				}
			}
			cutBase = null;
			return null;
		}

		/**
		 * Ask the Host where a mid-turn message may be cut. The browser cannot know it:
		 * the message enters the turn through a queue event the client never receives.
		 * @param options - session, event seq, message id and request id.
		 * @returns the last sequence the branch may keep.
		 */
		async function cutFromHost(options) {
			const base = await hostBase();
			if (base === null) throw new Error(t('noHost'));
			const query = new URLSearchParams();
			query.set('session', String(options.sessionId ?? ''));
			if (typeof options.seq === 'number') query.set('seq', String(options.seq));
			if (typeof options.id === 'string' && options.id !== '') query.set('id', options.id);
			if (typeof options.rpcId === 'string' && options.rpcId !== '') query.set('rpc', options.rpcId);
			const response = await fetch(base + '/dsh-edit-in-place/cut?' + query.toString(), { method: 'GET' });
			const body = await response.json().catch(() => null);
			if (body === null || body.ok !== true) throw new Error(typeof body?.error === 'string' && body.error !== '' ? body.error : t('noCut'));
			return typeof body.atSeq === 'number' ? body.atSeq : null;
		}

		/** The message being edited right now, shared between subscribers. */
		const store = {
			editing: null,
			listeners: new Set(),
		};

		/** Tell everyone listening that the editor changed. */
		function emit() {
			for (const listener of [...store.listeners]) {
				try {
					listener();
				} catch {
					/* one broken subscriber cannot close everyone else's editor */
				}
			}
		}

		/**
		 * Open the editor for one message.
		 * @param payload - message identity, session, cut, text and turn number.
		 */
		function openEditor(payload) {
			store.editing = payload;
			emit();
		}

		/** Close the editor without sending anything. */
		function closeEditor() {
			if (store.editing === null) return;
			store.editing = null;
			emit();
		}

		/**
		 * Read the open editor from React.
		 * @returns the message being edited, or null.
		 */
		function useEditing() {
			const [value, setValue] = react.useState(() => store.editing);
			react.useEffect(() => {
				const listener = () => setValue(store.editing);
				store.listeners.add(listener);
				listener();
				return () => {
					store.listeners.delete(listener);
				};
			}, []);
			return value;
		}

		/** Pencil, drawn here because the primitives ship no such glyph. */
		function PencilIcon() {
			return react.createElement('svg', {
				viewBox: '0 0 16 16',
				width: 15,
				height: 15,
				'aria-hidden': 'true',
				focusable: 'false',
			}, react.createElement('path', {
				d: 'M10.9 1.9a1.7 1.7 0 0 1 2.4 0l.8.8a1.7 1.7 0 0 1 0 2.4l-8.2 8.2-3.9.9.9-3.9 8-8.4Z',
				fill: 'none',
				stroke: 'currentColor',
				strokeWidth: 1.3,
				strokeLinejoin: 'round',
			}), react.createElement('path', {
				d: 'M9.6 3.3l3.1 3.1',
				fill: 'none',
				stroke: 'currentColor',
				strokeWidth: 1.3,
				strokeLinecap: 'round',
			}));
		}

		/**
		 * Copy glyph: the program's when it is there, one of our own when it is not.
		 * @param props - whether a copy just happened.
		 * @returns the glyph.
		 */
		function CopyIcon({ copied }) {
			const glyph = copied ? primitives.IconCheckOutlineRegular : primitives.IconCopyOutlineRegular;
			if (typeof glyph === 'function') return react.createElement(glyph, {});
			return react.createElement('svg', {
				viewBox: '0 0 16 16',
				width: 15,
				height: 15,
				'aria-hidden': 'true',
				focusable: 'false',
			}, react.createElement('path', {
				d: copied ? 'M3.2 8.4l3 3 6.6-7' : 'M5.6 5.6h7.2v7.2H5.6zM3.2 10.4V3.2h7.2',
				fill: 'none',
				stroke: 'currentColor',
				strokeWidth: 1.3,
				strokeLinecap: 'round',
				strokeLinejoin: 'round',
			}));
		}

		/**
		 * The message clock, with the date when it is not from today.
		 * @param time - message timestamp.
		 * @returns the short clock text.
		 */
		function clockText(time) {
			if (typeof time !== 'number' || !Number.isFinite(time)) return '';
			const date = new Date(time);
			if (Number.isNaN(date.getTime())) return '';
			const hh = String(date.getHours()).padStart(2, '0');
			const mm = String(date.getMinutes()).padStart(2, '0');
			const now = new Date();
			const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
			if (sameDay) return hh + ':' + mm;
			return String(date.getDate()).padStart(2, '0') + '/' + String(date.getMonth() + 1).padStart(2, '0') + ' ' + hh + ':' + mm;
		}

		/**
		 * The plain text of a message, for copying and for editing.
		 * @param node - message node.
		 * @returns the text.
		 */
		function messageText(node) {
			return contentParts(node?.data?.content).text;
		}

		/**
		 * Your message: the normal bubble, or a text box in the same place while it
		 * is being edited, with its pencil in the action row.
		 * @param props - the seat currency, the session kit and the resolved cut.
		 * @returns the message row.
		 */
		function UserMessageBubble(props) {
			const node = props.node;
			const data = node?.data ?? {};
			const parts = contentParts(data.content);
			const attachments = parts.attachments;
			const referenceLabels = Array.isArray(data.referenceLabels) ? data.referenceLabels : [];
			const skillNames = Array.isArray(data.skillNames) ? data.skillNames : [];
			const compactImages = attachments.length > 1;
			const showBubble = parts.text !== '' || parts.rest.length > 0;
			const [copied, setCopied] = react.useState(false);
			// null = the box has not been touched yet: it shows the message text,
			// whenever it mounts. That way a box that is born in edit mode can never
			// come up empty, which would lose your message.
			const [draft, setDraft] = react.useState(null);
			const [phase, setPhase] = react.useState('idle');
			const [error, setError] = react.useState('');
			const copyTimer = react.useRef(null);
			const areaRef = react.useRef(null);
			const pressAt = react.useRef(null);
			const open = useEditing();
			react.useEffect(() => () => {
				if (copyTimer.current !== null) clearTimeout(copyTimer.current);
			}, []);
			const steering = node?.kind === 'steering';
			// A mid-turn message enters the turn through an inbox splice that this plugin
			// cannot locate from the client, so there is no clean seq to branch before it.
			// It gets the same bubble, and a pencil that says why it is off.
			const canEdit = parts.text !== '' && typeof props.sessionId === 'string' && (steering === true || (typeof props.atSeq === 'number' && props.atSeq >= 0));
			const editing = open !== null && typeof node?.key === 'string' && open.key === node.key;
			const draftText = draft !== null ? draft : editing === true ? String(open.text ?? '') : parts.text;
			react.useEffect(() => {
				if (editing !== true) return;
				const area = areaRef.current;
				if (area === null || area === undefined) return;
				area.focus();
				area.setSelectionRange(area.value.length, area.value.length);
			}, [editing]);
			const reason = canEdit ? (phase === 'finding' ? t('resolve') : t('edit')) : parts.text === '' ? t('noText') : t('noBranch');
			const turnNumber = node?.location?.turn?.turn;
			const begin = react.useCallback(async () => {
				if (canEdit !== true || phase === 'finding' || phase === 'sending') return;
				let cut = props.atSeq;
				// A mid-turn message has no cut in the snapshot: the Host reads it from the
				// log, where the queue event that carried the message is visible.
				if (steering === true || typeof cut !== 'number' || cut < 0) {
					setPhase('finding');
					setError('');
					try {
						cut = await cutFromHost({
							sessionId: props.sessionId,
							seq: data.seq,
							id: data.id,
							rpcId: data.source?.rpcId,
						});
					} catch (failure) {
						setPhase('idle');
						setError(failure instanceof Error && failure.message !== '' ? failure.message : String(failure));
						return;
					}
				}
				if (typeof cut !== 'number' || cut < 0) {
					setPhase('idle');
					setError(t('noBranch'));
					return;
				}
				setDraft(null);
				setPhase('idle');
				setError('');
				openEditor({
					key: node?.key,
					sessionId: props.sessionId,
					atSeq: cut,
					text: parts.text,
					turnNumber: typeof turnNumber === 'number' ? turnNumber : undefined,
				});
			}, [canEdit, phase, steering, node?.key, props.sessionId, props.atSeq, parts.text, turnNumber, data.seq, data.id, data.source?.rpcId]);
			const send = react.useCallback(async () => {
				const text = String(draftText ?? '').trim();
				if (text === '' || phase === 'sending') return;
				setPhase('sending');
				setError('');
				try {
					const ctx = clientContext;
					if (ctx === null) throw new Error(t('noClient'));
					await resendInFork(ctx, { sessionId: props.sessionId, atSeq: props.atSeq, text });
					closeEditor();
				} catch (failure) {
					setPhase('idle');
					setError(failure instanceof Error && failure.message !== '' ? failure.message : String(failure));
				}
			}, [draftText, phase, props.sessionId, props.atSeq]);
			const onKeyDown = react.useCallback((event) => {
				if (event.key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();
					closeEditor();
					return;
				}
				if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent?.isComposing === true) return;
				event.preventDefault();
				void send();
			}, [send]);
			const copy = react.useCallback(() => {
				if (copied) return;
				const write = primitives.writeClipboard;
				if (typeof write !== 'function') return;
				write(parts.text).then((ok) => {
					if (ok !== true) return;
					setCopied(true);
					copyTimer.current = setTimeout(() => {
						copyTimer.current = null;
						setCopied(false);
					}, 1000);
				}, () => {});
			}, [copied, parts.text]);
			/** A click without a drag and without a selection opens the editor. */
			const onBubbleMouseDown = react.useCallback((event) => {
				pressAt.current = { x: event.clientX, y: event.clientY };
			}, []);
			const onBubbleMouseUp = react.useCallback((event) => {
				const start = pressAt.current;
				pressAt.current = null;
				if (start === null || canEdit !== true) return;
				if (Math.abs(event.clientX - start.x) > DRAG_TOLERANCE || Math.abs(event.clientY - start.y) > DRAG_TOLERANCE) return;
				let selected = '';
				try {
					selected = String(globalThis.getSelection?.() ?? '');
				} catch {
					selected = '';
				}
				if (selected !== '') return;
				void begin();
			}, [canEdit, begin]);
			if (editing === true) {
				const sending = phase === 'sending';
				return react.createElement('div', { className: 'dshem_editWrap', 'data-edit-in-place': 'message' },
					react.createElement('textarea', {
						ref: areaRef,
						className: 'dshem_editBox',
						value: draftText,
						rows: 3,
						spellCheck: false,
						disabled: sending,
						title: t('keys'),
						'aria-label': t('yourMessage'),
						'data-edit-in-place': 'text',
						onChange: (event) => setDraft(event.target.value),
						onKeyDown,
					}), error === '' ? null : react.createElement('p', { className: 'dshem_editError', role: 'status', 'data-edit-in-place': 'error' }, error),
					react.createElement('div', { className: 'dshem_editRow' },
						react.createElement('span', { className: 'dshem_editNote' }, t('note')),
						react.createElement('button', {
							type: 'button',
							className: 'dshem_small',
							disabled: sending,
							'data-edit-in-place': 'cancel',
							onClick: closeEditor,
						}, t('cancel')),
						react.createElement('button', {
							type: 'button',
							className: 'dshem_small dshem_send',
							disabled: sending || String(draftText ?? '').trim() === '',
							'data-edit-in-place': 'send',
							onClick: () => {
								void send();
							},
						}, sending ? t('updating') : t('update'))));
			}
			const references = { openFile: props.openFile, openSkill: props.openSkill };
			const project = primitives.projectUserText;
			const body = typeof project === 'function' ? project(parts.text, referenceLabels, skillNames, 'skill', references) : parts.text;
			const children = [];
			if (attachments.length > 0 && typeof props.renderMessageImages === 'function') {
				children.push(react.createElement('div', {
					key: 'attachments',
					className: both('attachmentRow'),
					'data-message-attachments': true,
				}, attachments.map((attachment, index) => {
					if (attachment.type === 'image') {
						return react.createElement(react.Fragment, { key: 'image:' + index },
							props.renderMessageImages({ images: [attachment.image], align: 'end', compact: compactImages }));
					}
					const name = String(attachment.file?.name ?? '');
					const extension = typeof primitives.fileExtension === 'function' ? primitives.fileExtension(name).toUpperCase().slice(0, 8) : '';
					const size = typeof primitives.fileSizeText === 'function' ? primitives.fileSizeText(attachment.file?.bytes ?? 0) : '';
					const meta = [extension, size].filter((value) => value !== '').join(' ');
					const icon = primitives.FileTypeIcon;
					return react.createElement('span', { key: 'file:' + index, className: both('fileCard'), title: name },
						typeof icon === 'function' ? react.createElement(icon, { path: name, className: both('fileIcon') }) : null,
						react.createElement('span', { className: both('fileContent') },
							react.createElement('span', { className: both('fileName') }, name),
							react.createElement('span', { className: both('fileMeta') }, meta)));
				})));
			}
			if (showBubble) {
				const extras = [];
				if (typeof primitives.JsonBlock === 'function') {
					parts.rest.forEach((block, index) => {
						extras.push(react.createElement(primitives.JsonBlock, {
							key: 'extra:' + index,
							label: t('extraBlock'),
							payload: block,
							truncatedLabel: (total) => t('truncated') + ' (' + total + ')',
						}));
					});
				}
				children.push(react.createElement('div', {
					key: 'bubble',
					className: both('bubble'),
					title: canEdit ? t('clickToEdit') : undefined,
					onMouseDown: onBubbleMouseDown,
					onMouseUp: onBubbleMouseUp,
				}, react.createElement(react.Fragment, null, body), extras));
			}
			if (referenceLabels.length > 0) {
				children.push(react.createElement('div', { key: 'references', className: both('referenceSummary') },
					t('references') + ' ' + referenceLabels.join(' · ')));
			}
			const actions = react.createElement('div', { className: 'dshem_uactions', 'data-edit-in-place': 'actions' },
				react.createElement('button', {
					type: 'button',
					className: 'dshem_uaction',
					'aria-label': reason,
					title: reason,
					disabled: canEdit && phase !== 'finding' ? undefined : true,
					'data-edit-in-place': 'pencil',
					onClick: () => {
						void begin();
					},
				}, react.createElement(PencilIcon, null)),
				react.createElement('span', { className: 'dshem_utime' }, clockText(data.time)),
				react.createElement('button', {
					type: 'button',
					className: 'dshem_uaction',
					'aria-label': copied ? t('copied') : t('copyMessage'),
					title: copied ? t('copied') : t('copy'),
					'data-edit-in-place': 'copy',
					onClick: copy,
				}, react.createElement(CopyIcon, { copied })));
			return react.createElement('div', { className: both('userRow'), 'data-edit-in-place': 'message' },
				react.createElement('div', { className: both('userStack') }, children),
				actions,
				error === '' ? null : react.createElement('p', { className: 'dshem_editError', role: 'status', 'data-edit-in-place': 'error' }, error));
		}

		/**
		 * With a snapshot: find the cut of the turn this message belongs to.
		 * @param props - seat props.
		 * @returns the bubble with its pencil.
		 */
		function UserMessageWithStore(props) {
			const node = props.node;
			const atSeq = props.useChat((snapshot) => selectBoundary(snapshot, node?.location?.turn, node?.data?.seq));
			return react.createElement(UserMessageBubble, { ...props, atSeq });
		}

		/**
		 * Pick the path: hooks cannot be called half way, so the decision is made
		 * before mounting the component that calls them.
		 * @param props - seat props.
		 * @returns the bubble, with or without the pencil.
		 */
		function UserMessageNode(props) {
			if (typeof props.useChat === 'function') return react.createElement(UserMessageWithStore, props);
			return react.createElement(UserMessageBubble, { ...props, atSeq: null });
		}

		/** The client context, so the editor can talk to the Host. */
		let clientContext = null;

		/**
		 * Services this plugin needs ready before the pencil is mounted.
		 * `sessions` is required: Cordis does not let a plugin read a service it has
		 * not declared, and without it there is no branch. `uiWorkspace` is optional
		 * and requested separately.
		 */
		const inject = ['slots', 'sessions'];

		/**
		 * Mount the plugin in the browser: your own messages, editable in place,
		 * with the pencil in their action row.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			clientContext = ctx;
			// Decide the language right away, from the reader alone. The locale service
			// below only refines it: if that service never appears, the reader's own
			// language must still win over the English default.
			followLocale(null);
			ctx.effect(() => () => {
				clientContext = null;
				closeEditor();
			}, 'dsh-edit-in-place: close the editor on unload');
			try {
				ctx.inject(['locale'], (scope) => followLocale(scope.locale));
			} catch {
				/* a composition without a locale service stays in English */
			}
			try {
				ctx.inject(['uiWorkspace'], (scope) => {
					const workspace = scope.uiWorkspace;
					navigateTo = (sessionId) => {
						try {
							workspace.openSession(sessionId);
						} catch {
							/* the branch exists even if the view does not jump */
						}
					};
				});
			} catch {
				/* a composition without a workspace view: the branch is still created */
			}
			// Two keys, not one. A message sent while the agent is answering is not a
			// `user` node: the program renders it as `steering`. Taking only `user` left
			// every mid-turn message on the program's renderer, with no pencil at all.
			for (const key of ['user', 'steering']) {
				ctx.slots.inject('conversation.chat.node', () => {
					try {
						// The program's own renderer occupies this key at priority 0, and the
						// LOWEST priority is the one that renders. Registering at 0 throws
						// "already has an entry for key", so the shadow has to be under it.
						// Getting this wrong is invisible until the first repaint: the
						// registration dies and the program's renderer comes back.
						return ctx.slots.register({
							name: 'conversation.chat.node',
							key,
							priority: -1,
						}, UserMessageNode);
					} catch (error) {
						console.warn('dsh-edit-in-place: could not take the ' + key + ' renderer', error);
						return () => {};
					}
				});
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.__internals = {
			STRINGS,
			t,
			followLocale,
			cutFromHost,
			hostBase,
			chooseLanguage,
			LANGUAGE_KEY,
			contentParts,
			serviceOf,
			locateTurn,
			startSeqFromOwner,
			selectBoundary,
			messageText,
			clockText,
			resendInFork,
			waitForBinding,
			openEditor,
			closeEditor,
			store,
			UserMessageNode,
			UserMessageBubble,
		};
		return module.exports;
	},
});
