/**
 * Gate for edit-in-place: it runs the plugin's REAL code and puts it through the
 * checks that can be done without a browser.
 *
 * This is not a mock. It loads `lib/client.js`, runs its `apply()` against a fake
 * client that imitates Cordis's prohibitions, and walks the real path — bubble,
 * pencil, in-place editing, Enter, Escape, send — calling the same components
 * React would call.
 *
 * The fixture numbers come from a real session log read with `tools/eventos.mjs`:
 * turn 1 with `turn/start` at 4 and `turn/end` at 218, turn 2 with `turn/start` at
 * 220 and `turn/end` at 375.
 *
 * Usage: node tools/verificar.mjs
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let passed = 0;
const failures = [];

/**
 * Run one synchronous check and record the outcome.
 * @param label - what is being checked.
 * @param work - the check itself.
 */
function check(label, work) {
	try {
		work();
		passed += 1;
		console.log(`  ok    ${label}`);
	} catch (error) {
		failures.push(`${label}: ${error.message}`);
		console.log(`  FAIL  ${label}\n        ${error.message}`);
	}
}

/**
 * Run one asynchronous check and record the outcome.
 * @param label - what is being checked.
 * @param work - the check itself, which may await.
 */
async function checkAsync(label, work) {
	try {
		await work();
		passed += 1;
		console.log(`  ok    ${label}`);
	} catch (error) {
		failures.push(`${label}: ${error.message}`);
		console.log(`  FAIL  ${label}\n        ${error.message}`);
	}
}

function equal(actual, expected, what) {
	if (actual !== expected) throw new Error(`${what}: expected ${JSON.stringify(expected)} and got ${JSON.stringify(actual)}`);
}

function truthy(value, what) {
	if (!value) throw new Error(`${what}: got ${JSON.stringify(value)}`);
}

/* ------------------------------------------------------------------ *
 * A fake React: just enough to walk the real components.
 * ------------------------------------------------------------------ */
function createFakeReact() {
	let store = [];
	let cursor = 0;
	/** A new component instance: clean state. */
	const reset = () => {
		store = [];
		cursor = 0;
	};
	/** Render the same component again: its state is kept. */
	const beginRender = () => {
		cursor = 0;
	};
	const react = {
		Fragment: 'Fragment',
		createElement(type, props, ...children) {
			const flat = children.length > 1 ? children : children[0];
			return { type, props: { ...(props ?? {}), children: flat } };
		},
		useState(initial) {
			const slot = cursor++;
			if (!(slot in store)) store[slot] = typeof initial === 'function' ? initial() : initial;
			return [
				store[slot],
				(next) => {
					store[slot] = typeof next === 'function' ? next(store[slot]) : next;
				},
			];
		},
		useRef(initial) {
			const slot = cursor++;
			if (!(slot in store)) store[slot] = { current: initial };
			return store[slot];
		},
		useEffect(effect) {
			const slot = cursor++;
			if (!(slot in store)) {
				store[slot] = true;
				effect();
			}
		},
		useCallback(fn) {
			cursor += 1;
			return fn;
		},
		useMemo(fn) {
			cursor += 1;
			return fn();
		},
		memo(fn) {
			return fn;
		},
	};
	return { react, reset, beginRender };
}

/** Walk a createElement tree for the first node that matches. */
function findNode(tree, predicate) {
	if (tree === null || tree === undefined || typeof tree !== 'object') return null;
	if (Array.isArray(tree)) {
		for (const child of tree) {
			const found = findNode(child, predicate);
			if (found !== null) return found;
		}
		return null;
	}
	if (predicate(tree)) return tree;
	const children = tree.props?.children;
	if (children === undefined) return null;
	return findNode(children, predicate);
}

/* ------------------------------------------------------------------ *
 * Fixture: a history with the numbering of a real DSH log.
 * ------------------------------------------------------------------ */
function buildTurns() {
	return {
		turnOne: { turn: 1, start: { seq: 4 }, end: { seq: 218 } },
		turnTwo: { turn: 2, start: { seq: 220 }, end: { seq: 375 } },
	};
}

function userNode(key, seq, text, turn) {
	return {
		key,
		kind: 'user',
		data: { seq, time: 1791847932267, content: [{ type: 'text', text }], source: { kind: 'user' }, referenceLabels: [], skillNames: [] },
		location: { kind: 'turn', turn },
	};
}

function buildSnapshot(turns) {
	return {
		timeline: {
			turnOrder: [1, 2],
			turns: new Map([[1, turns.turnOne], [2, turns.turnTwo]]),
		},
		nodes: new Map(),
	};
}

/* ------------------------------------------------------------------ *
 * Fake client: imitates Cordis and records everything the plugin does.
 * ------------------------------------------------------------------ */
function buildClient(options = {}) {
	const calls = { fork: [], openSession: [], prompt: [] };
	const childState = { openState: 'open' };
	const sessions = {
		async fork(input) {
			calls.fork.push(input);
			if (options.forkThrows !== undefined) throw new Error(options.forkThrows);
			return 'branch-1';
		},
		binding(id) {
			if (id !== 'branch-1') return undefined;
			if (childState.openState === 'cold') return undefined;
			return {
				session: {
					getSnapshot: () => ({ openState: childState.openState }),
					async prompt(content, mode) {
						calls.prompt.push({ content, mode });
						return options.promptResult ?? { ok: true, value: { accepted: true } };
					},
				},
			};
		},
	};
	const uiWorkspace = {
		openSession(id) {
			calls.openSession.push(id);
		},
	};
	const registrations = [];
	const ctx = {
		sessions,
		effect() {
			return () => {};
		},
		get(name) {
			// Cordis: reading a service that was not declared in `inject` throws. The
			// plugin must not depend on this to work.
			if (name === 'sessions') return sessions;
			throw new Error('cannot get property "' + name + '" without inject');
		},
		inject(names, callback) {
			for (const name of names) {
				if (name === 'uiWorkspace') {
					callback({ uiWorkspace });
					return () => {};
				}
			}
			return () => {};
		},
		slots: {
			inject(name, callback) {
				const registration = callback();
				registrations.push({ name, registration });
				return () => {};
			},
			register(spec, component) {
				return { spec, component };
			},
		},
	};
	return { ctx, calls, registrations, childState };
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */
console.log('Gate: edit and resend my own messages (in-place editing)\n');

let captured;
globalThis.window = {
	__ModuleLoader__: {
		load(definition) {
			captured = definition;
		},
	},
};

await import(pathToFileURL(join(ROOT, 'lib', 'client.js')).href);

const { react, reset, beginRender } = createFakeReact();
const copies = [];
const primitives = {
	projectUserText: (text) => ({ glyph: 'text', text }),
	writeClipboard: (text) => {
		copies.push(text);
		return Promise.resolve(true);
	},
	fileExtension: (name) => String(name).split('.').pop() ?? '',
	fileSizeText: (bytes) => bytes + ' B',
	JsonBlock: function JsonBlock(props) {
		return { type: 'jsonblock', props };
	},
	FileTypeIcon: function FileTypeIcon(props) {
		return { type: 'fileicon', props };
	},
	IconCopyOutlineRegular: function CopyGlyph() {
		return { type: 'copy' };
	},
	IconCheckOutlineRegular: function CheckGlyph() {
		return { type: 'copied' };
	},
};
let plugin;

check('the module declares a stable id', () => equal(captured.id, 'dsh-edit-in-place', 'id'));
check('the factory returns the plugin without touching the DOM', () => {
	plugin = captured.factory((name) => {
		if (name === 'react') return react;
		if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
		throw new Error(`unexpected require: ${name}`);
	});
	truthy(plugin, 'plugin');
});
check('it exports apply', () => equal(typeof plugin.apply, 'function', 'apply'));
check('it really declares its dependencies', () => {
	truthy(Array.isArray(plugin.inject), 'inject');
	equal(plugin.inject.includes('slots'), true, 'inject has slots');
	// Without declaring `sessions`, Cordis forbids reading it and sending died on screen.
	equal(plugin.inject.includes('sessions'), true, 'inject has sessions');
});

const internals = plugin.__internals;
const client = buildClient();
const turns = buildTurns();
const snapshot = buildSnapshot(turns);
const nodeOne = userNode('n1', 8, 'first question from the human', turns.turnOne);
const nodeTwo = userNode('n2', 223, 'second question from the human', turns.turnTwo);

check('the message of turn 2 cuts at the turn/end of turn 1 (218)', () => {
	const located = internals.locateTurn(snapshot, turns.turnTwo, 223);
	equal(located?.number, 2, 'turn number');
	equal(located?.atSeq, 218, 'cut');
	equal(located?.first, false, 'is the first');
});
check('the message of turn 1 cuts two positions before its turn/start (2)', () => {
	const located = internals.locateTurn(snapshot, turns.turnOne, 8);
	equal(located?.number, 1, 'turn number');
	equal(located?.atSeq, 2, 'cut');
	equal(located?.first, true, 'is the first');
});
check('the whole message text is read', () => {
	equal(internals.messageText(nodeTwo), 'second question from the human', 'text');
	equal(internals.messageText({ data: {} }), '', 'message without content');
	equal(internals.messageText(null), '', 'null message');
});
check('a broken snapshot does not throw', () => {
	equal(internals.locateTurn(null, null, undefined), null, 'turn');
	equal(internals.locateTurn({ timeline: {} }, {}, 1), null, 'turn');
	equal(internals.selectBoundary(null, turns.turnTwo, 223), null, 'cut');
});
check('serviceOf does not propagate the Cordis error', () => {
	equal(internals.serviceOf(client.ctx, 'sessions') !== undefined, true, 'finds sessions');
	equal(internals.serviceOf({ get() { throw new Error('without inject'); } }, 'uiWorkspace'), undefined, 'missing service');
	equal(internals.serviceOf(null, 'sessions'), undefined, 'null ctx');
});
check('the clock is short', () => {
	const now = Date.now();
	truthy(/^\d{2}:\d{2}$/.test(internals.clockText(now)), `today's clock: ${internals.clockText(now)}`);
	equal(internals.clockText(undefined), '', 'no clock');
});

/* ---------------- mounting: the pencil lives in the user message ---------- */
reset();
plugin.apply(client.ctx);

check('it takes the user key of the chat node seat', () => {
	const node = client.registrations.find((entry) => entry.name === 'conversation.chat.node');
	truthy(node, 'node registration');
	equal(node.registration.spec.key, 'user', 'taken key');
	equal(typeof node.registration.component, 'function', 'component');
});
check('there is no floating dialog any more: editing happens in place', () => {
	equal(client.registrations.some((entry) => entry.name === 'shell.overlay'), false, 'no overlay');
	equal(client.registrations.some((entry) => entry.name === 'conversation.chat.turnTail'), false, 'no turnTail');
});

const nodoComponent = client.registrations.find((entry) => entry.name === 'conversation.chat.node').registration.component;
const bubbleComponent = internals.UserMessageBubble;

/** Paint the bubble as a new component instance. */
function mount(node) {
	reset();
	return bubbleComponent({
		node,
		atSeq: 218,
		sessionId: 'original-session',
		openFile: () => {},
		openSkill: () => {},
		renderMessageImages: (props) => ({ type: 'images', props }),
	});
}

check('the message paints with its bubble and its text', () => {
	const tree = mount(nodeTwo);
	equal(tree?.props?.['data-edit-in-place'], 'message', 'message row');
	truthy(findNode(tree, (candidate) => typeof candidate?.props?.className === 'string' && candidate.props.className.includes('dshem_bubble')), 'bubble');
});
check('the pencil is INSIDE the user message', () => {
	const tree = mount(nodeTwo);
	const pencil = findNode(tree, (candidate) => candidate?.props?.['data-edit-in-place'] === 'pencil');
	truthy(pencil, 'pencil');
	equal(pencil.type, 'button', 'it is a button');
	equal(pencil.props.disabled, undefined, 'enabled');
	equal(pencil.props.title, 'Edit and resend this message', 'label');
});
check('the message still carries copy and the clock', () => {
	const tree = mount(nodeTwo);
	truthy(findNode(tree, (candidate) => candidate?.props?.['data-edit-in-place'] === 'copy'), 'copy button');
	const clock = findNode(tree, (candidate) => typeof candidate?.props?.className === 'string' && candidate.props.className.includes('dshem_utime'));
	truthy(clock, 'the clock');
	truthy(/^\d{2}:\d{2}$|^\d{2}\/\d{2} /.test(String(clock.props.children)), `clock: ${clock.props.children}`);
});
check('copy copies the message text', async () => {
	const tree = mount(nodeTwo);
	const copy = findNode(tree, (candidate) => candidate?.props?.['data-edit-in-place'] === 'copy');
	copy.props.onClick();
	await new Promise((resolve) => setTimeout(resolve, 10));
	equal(copies.at(-1), 'second question from the human', 'copied text');
});

check('without a snapshot the bubble still paints and the pencil is off', () => {
	reset();
	const outer = nodoComponent({ node: nodeTwo, sessionId: 'x', openFile: () => {}, openSkill: () => {} });
	truthy(outer, 'chosen component');
	reset();
	const tree = bubbleComponent({ node: nodeTwo, atSeq: null, sessionId: 'x', openFile: () => {}, openSkill: () => {} });
	const pencil = findNode(tree, (candidate) => candidate?.props?.['data-edit-in-place'] === 'pencil');
	equal(pencil.props.disabled, true, 'off');
});

/* ---------------- editing in place ---------------- */
internals.closeEditor();

check('pressing the pencil opens the edit IN THE SAME PLACE, with no dialog', () => {
	const tree = mount(nodeTwo);
	const pencil = findNode(tree, (candidate) => candidate?.props?.['data-edit-in-place'] === 'pencil');
	pencil.props.onClick();
	const payload = internals.store.editing;
	truthy(payload, 'edit opened');
	equal(payload.key, 'n2', 'message identified');
	equal(payload.atSeq, 218, 'cut');
	equal(payload.sessionId, 'original-session', 'session');
	equal(payload.text, 'second question from the human', 'text');
	// And the message repaints as a text box, not as a bubble or an overlay.
	beginRender();
	const editingTree = bubbleComponent({ node: nodeTwo, atSeq: 218, sessionId: 'original-session', openFile: () => {}, openSkill: () => {} });
	truthy(findNode(editingTree, (candidate) => candidate?.props?.['data-edit-in-place'] === 'text'), 'text box inside the bubble');
	equal(findNode(editingTree, (candidate) => candidate?.props?.['data-edit-in-place'] === 'pencil'), null, 'the pencil goes away while editing');
});

check('the box takes the width of the column and the buttons say Cancel and Update', () => {
	internals.openEditor({ key: 'n2', sessionId: 'original-session', atSeq: 218, text: 'hello', turnNumber: 2 });
	const tree = mount(nodeTwo);
	truthy(findNode(tree, (candidate) => candidate?.props?.className === 'dshem_editWrap'), 'full width container');
	const update = findNode(tree, (candidate) => candidate?.props?.['data-edit-in-place'] === 'send');
	equal(update.props.children, 'Update', 'button text');
	const cancel = findNode(tree, (candidate) => candidate?.props?.['data-edit-in-place'] === 'cancel');
	equal(cancel.props.children, 'Cancel', 'cancel text');
	internals.closeEditor();
});
check('the edit does not open on a message that is not its own', () => {
	internals.openEditor({ key: 'n2', sessionId: 'original-session', atSeq: 218, text: 'x', turnNumber: 2 });
	const tree = mount(nodeOne);
	equal(findNode(tree, (candidate) => candidate?.props?.['data-edit-in-place'] === 'text'), null, 'the other message stays a bubble');
	truthy(findNode(tree, (candidate) => typeof candidate?.props?.className === 'string' && candidate.props.className.includes('dshem_bubble')), 'bubble intact');
	internals.closeEditor();
});
check('a drag or a selection does not open the edit', () => {
	internals.closeEditor();
	const tree = mount(nodeTwo);
	const bubble = findNode(tree, (candidate) => typeof candidate?.props?.className === 'string' && candidate.props.className.includes('dshem_bubble'));
	bubble.props.onMouseDown({ clientX: 10, clientY: 10 });
	bubble.props.onMouseUp({ clientX: 60, clientY: 10 });
	equal(internals.store.editing, null, 'a drag does not edit');
	globalThis.getSelection = () => ({ toString: () => 'selected text' });
	bubble.props.onMouseDown({ clientX: 10, clientY: 10 });
	bubble.props.onMouseUp({ clientX: 10, clientY: 10 });
	equal(internals.store.editing, null, 'a selection does not edit');
	globalThis.getSelection = () => ({ toString: () => '' });
	bubble.props.onMouseDown({ clientX: 10, clientY: 10 });
	bubble.props.onMouseUp({ clientX: 11, clientY: 10 });
	truthy(internals.store.editing !== null, 'a clean click does edit');
	internals.closeEditor();
	delete globalThis.getSelection;
});

/* ---------------- the whole path ---------------- */
await checkAsync('sending creates the branch, opens it and sends the text', async () => {
	internals.openEditor({ key: 'n2', sessionId: 'original-session', atSeq: 218, text: 'second question from the human', turnNumber: 2 });
	reset();
	const tree = bubbleComponent({ node: nodeTwo, atSeq: 218, sessionId: 'original-session', openFile: () => {}, openSkill: () => {} });
	const textarea = findNode(tree, (candidate) => candidate?.props?.['data-edit-in-place'] === 'text');
	truthy(textarea, 'text box');
	equal(textarea.props.value, 'second question from the human', 'text in the box');
	const button = findNode(tree, (candidate) => candidate?.props?.['data-edit-in-place'] === 'send');
	truthy(button, 'send button');
	button.props.onClick();
	await new Promise((resolve) => setTimeout(resolve, 30));
	equal(client.calls.fork.length, 1, 'one branch only');
	equal(client.calls.fork[0].atSeq, 218, 'cut asked of the Host');
	equal(client.calls.fork[0].sessionId, 'original-session', 'source session');
	equal(client.calls.fork[0].increaseTitle, true, 'title incremented');
	equal(client.calls.openSession[0], 'branch-1', 'the view jumps to the branch');
	equal(client.calls.prompt.length, 1, 'one message sent');
	equal(client.calls.prompt[0].content?.[0]?.text, 'second question from the human', 'text sent');
	equal(client.calls.prompt[0].content?.[0]?.type, 'text', 'part type');
	equal(client.calls.prompt[0].mode, 'queue', 'mode');
	equal(internals.store.editing, null, 'the edit closes when it is done');
});

await checkAsync('what travels is the corrected text, not the original', async () => {
	internals.openEditor({ key: 'n2', sessionId: 'original-session', atSeq: 218, text: 'original', turnNumber: 2 });
	reset();
	const tree = bubbleComponent({ node: nodeTwo, atSeq: 218, sessionId: 'original-session', openFile: () => {}, openSkill: () => {} });
	const textarea = findNode(tree, (candidate) => candidate?.props?.['data-edit-in-place'] === 'text');
	equal(textarea.props.value, 'original', 'starting text');
	textarea.props.onChange({ target: { value: 'text corrected by hand' } });
	// State lives in the component: render the same one again, as React would.
	beginRender();
	const again = bubbleComponent({ node: nodeTwo, atSeq: 218, sessionId: 'original-session', openFile: () => {}, openSkill: () => {} });
	const shown = findNode(again, (candidate) => candidate?.props?.['data-edit-in-place'] === 'text');
	equal(shown.props.value, 'text corrected by hand', 'the box keeps what was typed');
	const send = findNode(again, (candidate) => candidate?.props?.['data-edit-in-place'] === 'send');
	const before = client.calls.prompt.length;
	send.props.onClick();
	await new Promise((resolve) => setTimeout(resolve, 30));
	equal(client.calls.prompt.length, before + 1, 'sent one more time');
	equal(client.calls.prompt.at(-1).content?.[0]?.text, 'text corrected by hand', 'the correction travels');
});

await checkAsync('Escape cancels without sending anything', async () => {
	internals.openEditor({ key: 'n2', sessionId: 'original-session', atSeq: 218, text: 'untouched', turnNumber: 2 });
	reset();
	const tree = bubbleComponent({ node: nodeTwo, atSeq: 218, sessionId: 'original-session', openFile: () => {}, openSkill: () => {} });
	const textarea = findNode(tree, (candidate) => candidate?.props?.['data-edit-in-place'] === 'text');
	const before = client.calls.fork.length;
	let prevented = false;
	textarea.props.onKeyDown({ key: 'Escape', preventDefault: () => { prevented = true; }, stopPropagation: () => {} });
	equal(prevented, true, 'Escape is taken');
	equal(internals.store.editing, null, 'the edit closes');
	equal(client.calls.fork.length, before, 'no branch was created');
});

await checkAsync('Enter sends', async () => {
	internals.openEditor({ key: 'n2', sessionId: 'original-session', atSeq: 218, text: 'with enter', turnNumber: 2 });
	reset();
	const tree = bubbleComponent({ node: nodeTwo, atSeq: 218, sessionId: 'original-session', openFile: () => {}, openSkill: () => {} });
	const textarea = findNode(tree, (candidate) => candidate?.props?.['data-edit-in-place'] === 'text');
	const before = client.calls.prompt.length;
	textarea.props.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault: () => {}, stopPropagation: () => {} });
	await new Promise((resolve) => setTimeout(resolve, 30));
	equal(client.calls.prompt.length, before + 1, 'Enter sends');
	equal(client.calls.prompt.at(-1).content?.[0]?.text, 'with enter', 'text sent');
});

await checkAsync('Shift+Enter sends nothing', async () => {
	internals.openEditor({ key: 'n2', sessionId: 'original-session', atSeq: 218, text: 'line break', turnNumber: 2 });
	reset();
	const tree = bubbleComponent({ node: nodeTwo, atSeq: 218, sessionId: 'original-session', openFile: () => {}, openSkill: () => {} });
	const textarea = findNode(tree, (candidate) => candidate?.props?.['data-edit-in-place'] === 'text');
	const before = client.calls.prompt.length;
	textarea.props.onKeyDown({ key: 'Enter', shiftKey: true, preventDefault: () => {}, stopPropagation: () => {} });
	await new Promise((resolve) => setTimeout(resolve, 20));
	equal(client.calls.prompt.length, before, 'does not send');
	internals.closeEditor();
});

await checkAsync('if the Host rejects the send, the reason is shown in the bubble', async () => {
	const failing = buildClient({ promptResult: { ok: false, error: { message: 'quota exhausted' } } });
	reset();
	plugin.apply(failing.ctx);
	internals.openEditor({ key: 'n2', sessionId: 'original-session', atSeq: 218, text: 'hello', turnNumber: 2 });
	reset();
	const tree = bubbleComponent({ node: nodeTwo, atSeq: 218, sessionId: 'original-session', openFile: () => {}, openSkill: () => {} });
	const send = findNode(tree, (candidate) => candidate?.props?.['data-edit-in-place'] === 'send');
	send.props.onClick();
	await new Promise((resolve) => setTimeout(resolve, 40));
	truthy(internals.store.editing !== null, 'the edit stays open after the failure');
	beginRender();
	const reopened = bubbleComponent({ node: nodeTwo, atSeq: 218, sessionId: 'original-session', openFile: () => {}, openSkill: () => {} });
	const error = findNode(reopened, (candidate) => candidate?.props?.['data-edit-in-place'] === 'error');
	truthy(error, 'error message visible');
	equal(error.props.children, 'quota exhausted', 'reason from the Host');
	internals.closeEditor();
});

await checkAsync('a branch that does not open ends in a readable error', async () => {
	const broken = buildClient();
	broken.childState.openState = 'error';
	await internals
		.resendInFork(broken.ctx, { sessionId: 'original-session', atSeq: 218, text: 'hello', timeoutMs: 50 })
		.then(() => {
			throw new Error('it should have failed');
		})
		.catch((error) => {
			truthy(String(error.message).includes('could not be opened'), `message: ${error.message}`);
		});
});

await checkAsync('without the sessions service the error is readable, not Cordis jargon', async () => {
	const ctx = {
		effect: () => () => {},
		slots: { inject() {}, register() {} },
		get(name) {
			throw new Error('cannot get property "' + name + '" without inject');
		},
	};
	Object.defineProperty(ctx, 'sessions', {
		get() {
			throw new Error('cannot get property "sessions" without inject');
		},
	});
	await internals
		.resendInFork(ctx, { sessionId: 's', atSeq: 10, text: 'hello' })
		.then(() => {
			throw new Error('it should have failed');
		})
		.catch((error) => {
			truthy(String(error.message).includes('sessions service'), 'readable message: ' + error.message);
			equal(String(error.message).includes('without inject'), false, 'no Cordis jargon');
		});
});

await checkAsync('an impossible cut is rejected before touching the Host', async () => {
	const clean = buildClient();
	await internals
		.resendInFork(clean.ctx, { sessionId: 's', atSeq: null, text: 'hello' })
		.then(() => {
			throw new Error('it should have failed');
		})
		.catch((error) => {
			equal(clean.calls.fork.length, 0, 'branches created');
			truthy(String(error.message).includes('cut'), `message: ${error.message}`);
		});
});

await checkAsync('an empty text is not sent', async () => {
	const clean = buildClient();
	await internals
		.resendInFork(clean.ctx, { sessionId: 's', atSeq: 10, text: '   ' })
		.then(() => {
			throw new Error('it should have failed');
		})
		.catch((error) => {
			equal(clean.calls.fork.length, 0, 'branches created');
			truthy(String(error.message).includes('empty'), `message: ${error.message}`);
		});
});

/* ---------------- CSS guards: things only a screen would show ---------------- */
const source = fs.readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');

check('the confirm button uses the program\'s own colour pair', () => {
	// The label came out invisible on dark themes: the brand accent there is nearly
	// white and the text was white too. The program solves it with a filled-button
	// token, so that is copied exactly.
	const rule = /\.dshem_send\{([^}]*)\}/.exec(source);
	truthy(rule, '.dshem_send rule');
	truthy(rule[1].includes('dsw-alias-button-info-fill'), 'program fill');
	truthy(rule[1].includes('color:#fff'), 'white label');
	const broken = /\.dshem_send\{[^}]*background:var\(--dsw-alias-brand-primary\)[^}]*color:#fff/.test(source);
	equal(broken, false, 'no white on white');
});

check('both buttons are the same size and the same shape', () => {
	// Same height, same minimum width and same radius, so they can never drift
	// apart: the fill may only change colour.
	const base = /\.dshem_small\{([^}]*)\}/.exec(source);
	truthy(base, '.dshem_small rule');
	truthy(base[1].includes('min-width'), 'shared minimum width');
	truthy(base[1].includes('border-radius:8px'), 'shared radius');
	truthy(base[1].includes('box-sizing:border-box'), 'shared box');
	truthy(base[1].includes('border:1px solid'), 'shared border');
	const fill = /\.dshem_send\{([^}]*)\}/.exec(source);
	truthy(fill, '.dshem_send rule');
	equal(/border-radius/.test(fill[1]), false, 'the fill does not change the shape');
	equal(/padding|min-width|font-size/.test(fill[1]), false, 'the fill does not change the size');
});

/* ---------------- the Host half ---------------- */
const host = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href);
check('the Host half exports apply and name', () => {
	equal(typeof host.apply, 'function', 'apply');
	equal(host.name, 'edit-in-place', 'name');
});
check('the Host half does not break without a logger', () => {
	host.apply({});
	host.apply({ logger: { info: () => {} } });
});

console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length > 0) {
	for (const failure of failures) console.log(`  - ${failure}`);
	process.exit(1);
}
