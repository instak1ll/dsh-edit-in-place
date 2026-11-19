/**
 * Portero de «editar mis mensajes»: ejecuta el codigo REAL del plugin y lo
 * somete a las comprobaciones que se pueden hacer sin navegador.
 *
 * No es un simulacro. Se carga `lib/client.js`, se ejecuta su `apply()` contra
 * un cliente falso que imita las prohibiciones de Cordis, y se recorre el camino
 * de verdad —burbuja, lapiz, edicion EN EL SITIO, reenviar— llamando a los mismos
 * componentes que llamaria React.
 *
 * Las cifras del fixture son las del log de una sesion real sondeado con
 * `tools/eventos.mjs`: turno 1 con `turn/start` en 4 y `turn/end` en 218, turno
 * 2 con `turn/start` en 220 y `turn/end` en 375.
 *
 * Uso: node tools/verificar.mjs
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let passed = 0;
const failures = [];

function check(label, work) {
	try {
		work();
		passed += 1;
		console.log(`  ok    ${label}`);
	} catch (error) {
		failures.push(`${label}: ${error.message}`);
		console.log(`  FALLO ${label}\n        ${error.message}`);
	}
}

async function checkAsync(label, work) {
	try {
		await work();
		passed += 1;
		console.log(`  ok    ${label}`);
	} catch (error) {
		failures.push(`${label}: ${error.message}`);
		console.log(`  FALLO ${label}\n        ${error.message}`);
	}
}

function equal(actual, expected, what) {
	if (actual !== expected) throw new Error(`${what}: esperaba ${JSON.stringify(expected)} y llego ${JSON.stringify(actual)}`);
}

function truthy(value, what) {
	if (!value) throw new Error(`${what}: llego ${JSON.stringify(value)}`);
}

/* ------------------------------------------------------------------ *
 * React de mentira: lo justo para recorrer los componentes de verdad.
 * ------------------------------------------------------------------ */
function createFakeReact() {
	let store = [];
	let cursor = 0;
	/** Componente nuevo: estado limpio. */
	const reset = () => {
		store = [];
		cursor = 0;
	};
	/** Volver a pintar el mismo componente: se conserva su estado. */
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

/** Recorrer un arbol de createElement buscando el primer nodo que cumpla. */
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
 * Fixture: historial con la numeracion real de un log de DSH.
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
 * Cliente falso: imita a Cordis y apunta todo lo que el plugin hace.
 * ------------------------------------------------------------------ */
function buildClient(options = {}) {
	const calls = { fork: [], openSession: [], prompt: [] };
	const childState = { openState: 'open' };
	const sessions = {
		async fork(input) {
			calls.fork.push(input);
			if (options.forkThrows !== undefined) throw new Error(options.forkThrows);
			return 'rama-1';
		},
		binding(id) {
			if (id !== 'rama-1') return undefined;
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
			// Cordis: leer un servicio no declarado en `inject` lanza. El plugin
			// no debe depender de esto para funcionar.
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
 * Ejecucion
 * ------------------------------------------------------------------ */
console.log('Portero: editar y reenviar mis mensajes (edicion en el sitio)\n');

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
	projectUserText: (text) => ({ glyph: 'texto', text }),
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
		return { type: 'copiar' };
	},
	IconCheckOutlineRegular: function CheckGlyph() {
		return { type: 'copiado' };
	},
};
let plugin;

check('el modulo declara un id estable', () => equal(captured.id, 'dsh-edit-in-place', 'id'));
check('la fabrica devuelve el plugin sin tocar el DOM', () => {
	plugin = captured.factory((name) => {
		if (name === 'react') return react;
		if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
		throw new Error(`require inesperado: ${name}`);
	});
	truthy(plugin, 'plugin');
});
check('exporta apply', () => equal(typeof plugin.apply, 'function', 'apply'));
check('declara sus dependencias de verdad', () => {
	truthy(Array.isArray(plugin.inject), 'inject');
	equal(plugin.inject.includes('slots'), true, 'inject contiene slots');
	// Sin declarar `sessions`, cordis prohibe leerlo y el reenvio murio en pantalla.
	equal(plugin.inject.includes('sessions'), true, 'inject contiene sessions');
});

const internals = plugin.__internals;
const client = buildClient();
const turns = buildTurns();
const snapshot = buildSnapshot(turns);
const nodeOne = userNode('n1', 8, 'primera pregunta del humano', turns.turnOne);
const nodeTwo = userNode('n2', 223, 'segunda pregunta del humano', turns.turnTwo);

check('el mensaje del turno 2 corta en el turn/end del turno 1 (218)', () => {
	const located = internals.locateTurn(snapshot, turns.turnTwo, 223);
	equal(located?.number, 2, 'numero de turno');
	equal(located?.atSeq, 218, 'corte');
	equal(located?.first, false, 'es el primero');
});
check('el mensaje del turno 1 corta dos posiciones antes de su turn/start (2)', () => {
	const located = internals.locateTurn(snapshot, turns.turnOne, 8);
	equal(located?.number, 1, 'numero de turno');
	equal(located?.atSeq, 2, 'corte');
	equal(located?.first, true, 'es el primero');
});
check('el texto del mensaje se lee entero', () => {
	equal(internals.messageText(nodeTwo), 'segunda pregunta del humano', 'texto');
	equal(internals.messageText({ data: {} }), '', 'mensaje sin contenido');
	equal(internals.messageText(null), '', 'mensaje nulo');
});
check('un snapshot roto no lanza', () => {
	equal(internals.locateTurn(null, null, undefined), null, 'turno');
	equal(internals.locateTurn({ timeline: {} }, {}, 1), null, 'turno');
	equal(internals.selectBoundary(null, turns.turnTwo, 223), null, 'corte');
});
check('serviceOf no propaga el error de cordis', () => {
	equal(internals.serviceOf(client.ctx, 'sessions') !== undefined, true, 'encuentra sessions');
	equal(internals.serviceOf({ get() { throw new Error('sin inject'); } }, 'uiWorkspace'), undefined, 'sin servicio');
	equal(internals.serviceOf(null, 'sessions'), undefined, 'ctx nulo');
});
check('la hora se pinta corta', () => {
	const now = Date.now();
	truthy(/^\d{2}:\d{2}$/.test(internals.clockText(now)), `hora de hoy: ${internals.clockText(now)}`);
	equal(internals.clockText(undefined), '', 'sin hora');
});

/* ---------------- montaje: el lapiz va en el mensaje del usuario ---------- */
reset();
plugin.apply(client.ctx);

check('ocupa la clave user del asiento de nodos del chat', () => {
	const nodo = client.registrations.find((entry) => entry.name === 'conversation.chat.node');
	truthy(nodo, 'registro del nodo');
	equal(nodo.registration.spec.key, 'user', 'clave ocupada');
	equal(typeof nodo.registration.component, 'function', 'componente');
});
check('ya NO hay dialogo flotante: se edita en el sitio', () => {
	equal(client.registrations.some((entry) => entry.name === 'shell.overlay'), false, 'sin capa flotante');
	equal(client.registrations.some((entry) => entry.name === 'conversation.chat.turnTail'), false, 'sin turnTail');
});

const nodoComponent = client.registrations.find((entry) => entry.name === 'conversation.chat.node').registration.component;
const bubbleComponent = internals.UserMessageBubble;

/** Pintar la burbuja como componente nuevo. */
function mount(node) {
	reset();
	return bubbleComponent({
		node,
		atSeq: 218,
		sessionId: 'sesion-original',
		openFile: () => {},
		openSkill: () => {},
		renderMessageImages: (props) => ({ type: 'imagenes', props }),
	});
}

check('el mensaje se pinta con su burbuja y su texto', () => {
	const tree = mount(nodeTwo);
	equal(tree?.props?.['data-editar-mensaje'], 'mensaje', 'fila del mensaje');
	truthy(findNode(tree, (candidate) => typeof candidate?.props?.className === 'string' && candidate.props.className.includes('dshem_bubble')), 'burbuja');
});
check('el lapiz esta DENTRO del mensaje del usuario', () => {
	const tree = mount(nodeTwo);
	const lapiz = findNode(tree, (candidate) => candidate?.props?.['data-editar-mensaje'] === 'lapiz');
	truthy(lapiz, 'lapiz');
	equal(lapiz.type, 'button', 'es un boton');
	equal(lapiz.props.disabled, undefined, 'habilitado');
	equal(lapiz.props.title, 'Editar y reenviar este mensaje', 'etiqueta');
});
check('el mensaje trae copiar y la hora, como antes', () => {
	const tree = mount(nodeTwo);
	truthy(findNode(tree, (candidate) => candidate?.props?.['data-editar-mensaje'] === 'copiar'), 'boton de copiar');
	const hora = findNode(tree, (candidate) => typeof candidate?.props?.className === 'string' && candidate.props.className.includes('dshem_utime'));
	truthy(hora, 'la hora');
	truthy(/^\d{2}:\d{2}$|^\d{2}\/\d{2} /.test(String(hora.props.children)), `hora: ${hora.props.children}`);
});
check('copiar copia el texto del mensaje', async () => {
	const tree = mount(nodeTwo);
	const copiar = findNode(tree, (candidate) => candidate?.props?.['data-editar-mensaje'] === 'copiar');
	copiar.props.onClick();
	await new Promise((resolve) => setTimeout(resolve, 10));
	equal(copies.at(-1), 'segunda pregunta del humano', 'texto copiado');
});

check('sin snapshot la burbuja se pinta igual y el lapiz queda apagado', () => {
	reset();
	const outer = nodoComponent({ node: nodeTwo, sessionId: 'x', openFile: () => {}, openSkill: () => {} });
	truthy(outer, 'componente elegido');
	reset();
	const tree = bubbleComponent({ node: nodeTwo, atSeq: null, sessionId: 'x', openFile: () => {}, openSkill: () => {} });
	const lapiz = findNode(tree, (candidate) => candidate?.props?.['data-editar-mensaje'] === 'lapiz');
	equal(lapiz.props.disabled, true, 'apagado');
});

/* ---------------- edicion en el sitio ---------------- */
internals.closeEditor();

check('pulsar el lapiz abre la edicion EN EL MISMO HUECO, sin dialogo', () => {
	const tree = mount(nodeTwo);
	const lapiz = findNode(tree, (candidate) => candidate?.props?.['data-editar-mensaje'] === 'lapiz');
	lapiz.props.onClick();
	const payload = internals.store.editing;
	truthy(payload, 'edicion abierta');
	equal(payload.key, 'n2', 'mensaje identificado');
	equal(payload.atSeq, 218, 'corte');
	equal(payload.sessionId, 'sesion-original', 'sesion');
	equal(payload.text, 'segunda pregunta del humano', 'texto');
	// Y el mensaje se repinta como caja de texto, no como burbuja ni capa flotante.
	beginRender();
	const editingTree = bubbleComponent({ node: nodeTwo, atSeq: 218, sessionId: 'sesion-original', openFile: () => {}, openSkill: () => {} });
	truthy(findNode(editingTree, (candidate) => candidate?.props?.['data-editar-mensaje'] === 'texto'), 'caja de texto en la burbuja');
	equal(findNode(editingTree, (candidate) => candidate?.props?.['data-editar-mensaje'] === 'lapiz'), null, 'el lapiz desaparece mientras editas');
});

check('la caja ocupa el ancho de la columna y los botones dicen Cancelar y Actualizar', () => {
	internals.openEditor({ key: 'n2', sessionId: 'sesion-original', atSeq: 218, text: 'hola', turnNumber: 2 });
	const tree = mount(nodeTwo);
	truthy(findNode(tree, (candidate) => candidate?.props?.className === 'dshem_editWrap'), 'contenedor a lo ancho');
	const actualizar = findNode(tree, (candidate) => candidate?.props?.['data-editar-mensaje'] === 'reenviar');
	equal(actualizar.props.children, 'Actualizar', 'texto del boton');
	const cancelar = findNode(tree, (candidate) => candidate?.props?.['data-editar-mensaje'] === 'cancelar');
	equal(cancelar.props.children, 'Cancelar', 'texto de cancelar');
	internals.closeEditor();
});
check('la edicion no se abre en un mensaje que no es el suyo', () => {
	internals.openEditor({ key: 'n2', sessionId: 'sesion-original', atSeq: 218, text: 'x', turnNumber: 2 });
	const tree = mount(nodeOne);
	equal(findNode(tree, (candidate) => candidate?.props?.['data-editar-mensaje'] === 'texto'), null, 'el otro mensaje sigue siendo burbuja');
	truthy(findNode(tree, (candidate) => typeof candidate?.props?.className === 'string' && candidate.props.className.includes('dshem_bubble')), 'burbuja intacta');
	internals.closeEditor();
});

check('un clic con arrastre o con texto seleccionado no abre la edicion', () => {
	internals.closeEditor();
	const tree = mount(nodeTwo);
	const bubble = findNode(tree, (candidate) => typeof candidate?.props?.className === 'string' && candidate.props.className.includes('dshem_bubble'));
	bubble.props.onMouseDown({ clientX: 10, clientY: 10 });
	bubble.props.onMouseUp({ clientX: 60, clientY: 10 });
	equal(internals.store.editing, null, 'un arrastre no edita');
	globalThis.getSelection = () => ({ toString: () => 'texto seleccionado' });
	bubble.props.onMouseDown({ clientX: 10, clientY: 10 });
	bubble.props.onMouseUp({ clientX: 10, clientY: 10 });
	equal(internals.store.editing, null, 'una seleccion no edita');
	globalThis.getSelection = () => ({ toString: () => '' });
	bubble.props.onMouseDown({ clientX: 10, clientY: 10 });
	bubble.props.onMouseUp({ clientX: 11, clientY: 10 });
	truthy(internals.store.editing !== null, 'un clic limpio si edita');
	internals.closeEditor();
	delete globalThis.getSelection;
});

/* ---------------- flujo completo ---------------- */
await checkAsync('al reenviar se crea la rama, se abre y se manda el texto', async () => {
	internals.openEditor({ key: 'n2', sessionId: 'sesion-original', atSeq: 218, text: 'segunda pregunta del humano', turnNumber: 2 });
	reset();
	const tree = bubbleComponent({ node: nodeTwo, atSeq: 218, sessionId: 'sesion-original', openFile: () => {}, openSkill: () => {} });
	const textarea = findNode(tree, (candidate) => candidate?.props?.['data-editar-mensaje'] === 'texto');
	truthy(textarea, 'caja de texto');
	equal(textarea.props.value, 'segunda pregunta del humano', 'texto inicial en la caja');
	const button = findNode(tree, (candidate) => candidate?.props?.['data-editar-mensaje'] === 'reenviar');
	truthy(button, 'boton de reenviar');
	button.props.onClick();
	await new Promise((resolve) => setTimeout(resolve, 30));
	equal(client.calls.fork.length, 1, 'una sola rama');
	equal(client.calls.fork[0].atSeq, 218, 'corte pedido al Host');
	equal(client.calls.fork[0].sessionId, 'sesion-original', 'sesion de origen');
	equal(client.calls.fork[0].increaseTitle, true, 'titulo incrementado');
	equal(client.calls.openSession[0], 'rama-1', 'la vista salta a la rama');
	equal(client.calls.prompt.length, 1, 'un mensaje reenviado');
	equal(client.calls.prompt[0].content?.[0]?.text, 'segunda pregunta del humano', 'texto reenviado');
	equal(client.calls.prompt[0].content?.[0]?.type, 'text', 'tipo de parte');
	equal(client.calls.prompt[0].mode, 'queue', 'modo');
	equal(internals.store.editing, null, 'la edicion se cierra al terminar');
});

await checkAsync('lo que viaja es el texto corregido, no el original', async () => {
	internals.openEditor({ key: 'n2', sessionId: 'sesion-original', atSeq: 218, text: 'original', turnNumber: 2 });
	reset();
	const tree = bubbleComponent({ node: nodeTwo, atSeq: 218, sessionId: 'sesion-original', openFile: () => {}, openSkill: () => {} });
	const textarea = findNode(tree, (candidate) => candidate?.props?.['data-editar-mensaje'] === 'texto');
	equal(textarea.props.value, 'original', 'texto de partida');
	textarea.props.onChange({ target: { value: 'texto corregido a mano' } });
	// El estado vive en el componente: se vuelve a pintar el mismo, como React.
	beginRender();
	const again = bubbleComponent({ node: nodeTwo, atSeq: 218, sessionId: 'sesion-original', openFile: () => {}, openSkill: () => {} });
	const shown = findNode(again, (candidate) => candidate?.props?.['data-editar-mensaje'] === 'texto');
	equal(shown.props.value, 'texto corregido a mano', 'la caja conserva lo escrito');
	const send = findNode(again, (candidate) => candidate?.props?.['data-editar-mensaje'] === 'reenviar');
	const before = client.calls.prompt.length;
	send.props.onClick();
	await new Promise((resolve) => setTimeout(resolve, 30));
	equal(client.calls.prompt.length, before + 1, 'se mando una vez mas');
	equal(client.calls.prompt.at(-1).content?.[0]?.text, 'texto corregido a mano', 'viaja lo corregido');
});

await checkAsync('Escape cancela sin mandar nada', async () => {
	internals.openEditor({ key: 'n2', sessionId: 'sesion-original', atSeq: 218, text: 'sin tocar', turnNumber: 2 });
	reset();
	const tree = bubbleComponent({ node: nodeTwo, atSeq: 218, sessionId: 'sesion-original', openFile: () => {}, openSkill: () => {} });
	const textarea = findNode(tree, (candidate) => candidate?.props?.['data-editar-mensaje'] === 'texto');
	const before = client.calls.fork.length;
	let prevented = false;
	textarea.props.onKeyDown({ key: 'Escape', preventDefault: () => { prevented = true; }, stopPropagation: () => {} });
	equal(prevented, true, 'Escape se toma');
	equal(internals.store.editing, null, 'la edicion se cierra');
	equal(client.calls.fork.length, before, 'no se creo ninguna rama');
});

await checkAsync('Enter reenvia', async () => {
	internals.openEditor({ key: 'n2', sessionId: 'sesion-original', atSeq: 218, text: 'con enter', turnNumber: 2 });
	reset();
	const tree = bubbleComponent({ node: nodeTwo, atSeq: 218, sessionId: 'sesion-original', openFile: () => {}, openSkill: () => {} });
	const textarea = findNode(tree, (candidate) => candidate?.props?.['data-editar-mensaje'] === 'texto');
	const before = client.calls.prompt.length;
	textarea.props.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault: () => {}, stopPropagation: () => {} });
	await new Promise((resolve) => setTimeout(resolve, 30));
	equal(client.calls.prompt.length, before + 1, 'Enter manda');
	equal(client.calls.prompt.at(-1).content?.[0]?.text, 'con enter', 'texto enviado');
});

await checkAsync('Shift+Enter no manda nada', async () => {
	internals.openEditor({ key: 'n2', sessionId: 'sesion-original', atSeq: 218, text: 'salto de linea', turnNumber: 2 });
	reset();
	const tree = bubbleComponent({ node: nodeTwo, atSeq: 218, sessionId: 'sesion-original', openFile: () => {}, openSkill: () => {} });
	const textarea = findNode(tree, (candidate) => candidate?.props?.['data-editar-mensaje'] === 'texto');
	const before = client.calls.prompt.length;
	textarea.props.onKeyDown({ key: 'Enter', shiftKey: true, preventDefault: () => {}, stopPropagation: () => {} });
	await new Promise((resolve) => setTimeout(resolve, 20));
	equal(client.calls.prompt.length, before, 'no manda');
	internals.closeEditor();
});

await checkAsync('si el Host rechaza el envio, el motivo se ve en la burbuja', async () => {
	const fallon = buildClient({ promptResult: { ok: false, error: { message: 'cuota agotada' } } });
	reset();
	plugin.apply(fallon.ctx);
	internals.openEditor({ key: 'n2', sessionId: 'sesion-original', atSeq: 218, text: 'hola', turnNumber: 2 });
	reset();
	const tree = bubbleComponent({ node: nodeTwo, atSeq: 218, sessionId: 'sesion-original', openFile: () => {}, openSkill: () => {} });
	const send = findNode(tree, (candidate) => candidate?.props?.['data-editar-mensaje'] === 'reenviar');
	send.props.onClick();
	await new Promise((resolve) => setTimeout(resolve, 40));
	truthy(internals.store.editing !== null, 'la edicion sigue abierta tras el fallo');
	beginRender();
	const reopened = bubbleComponent({ node: nodeTwo, atSeq: 218, sessionId: 'sesion-original', openFile: () => {}, openSkill: () => {} });
	const error = findNode(reopened, (candidate) => candidate?.props?.['data-editar-mensaje'] === 'error');
	truthy(error, 'mensaje de error visible');
	equal(error.props.children, 'cuota agotada', 'motivo del Host');
	internals.closeEditor();
});

await checkAsync('una rama que no abre termina en error legible', async () => {
	const cojo = buildClient();
	cojo.childState.openState = 'error';
	await internals
		.resendInFork(cojo.ctx, { sessionId: 'sesion-original', atSeq: 218, text: 'hola', timeoutMs: 50 })
		.then(() => {
			throw new Error('deberia haber fallado');
		})
		.catch((error) => {
			truthy(String(error.message).includes('no se pudo abrir'), `mensaje: ${error.message}`);
		});
});

await checkAsync('sin el servicio de sesiones el error es legible, no de cordis', async () => {
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
		.resendInFork(ctx, { sessionId: 's', atSeq: 10, text: 'hola' })
		.then(() => {
			throw new Error('deberia haber fallado');
		})
		.catch((error) => {
			truthy(String(error.message).includes('servicio de sesiones'), 'mensaje legible: ' + error.message);
			equal(String(error.message).includes('without inject'), false, 'sin jerga de cordis');
		});
});

await checkAsync('un corte imposible se rechaza antes de tocar el Host', async () => {
	const limpio = buildClient();
	await internals
		.resendInFork(limpio.ctx, { sessionId: 's', atSeq: null, text: 'hola' })
		.then(() => {
			throw new Error('deberia haber fallado');
		})
		.catch((error) => {
			equal(limpio.calls.fork.length, 0, 'ramas creadas');
			truthy(String(error.message).includes('cortar'), `mensaje: ${error.message}`);
		});
});

await checkAsync('un texto vacio no se manda', async () => {
	const limpio = buildClient();
	await internals
		.resendInFork(limpio.ctx, { sessionId: 's', atSeq: 10, text: '   ' })
		.then(() => {
			throw new Error('deberia haber fallado');
		})
		.catch((error) => {
			equal(limpio.calls.fork.length, 0, 'ramas creadas');
			truthy(String(error.message).includes('vacio'), `mensaje: ${error.message}`);
		});
});

check('el boton de confirmar usa el par de colores del programa', () => {
	// La etiqueta se quedo invisible en tema oscuro: el acento de marca es casi
	// blanco ahi, y el texto tambien era blanco. El programa resuelve esto con
	// `--dsw-alias-button-info-fill` y etiqueta blanca, asi que se copia igual.
	const fuente = fs.readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
	const regla = /.dshem_send{([^}]*)}/.exec(fuente);
	truthy(regla, 'regla .dshem_send');
	truthy(regla[1].includes('dsw-alias-button-info-fill'), 'fondo del programa');
	truthy(regla[1].includes('color:#fff'), 'etiqueta blanca');
	const problema = /\.dshem_send\{[^}]*background:var\(--dsw-alias-brand-primary\)[^}]*color:#fff/.test(fuente);
	equal(problema, false, 'sin blanco sobre blanco');
});

check('los dos botones miden y se redondean igual', () => {
	// El Creador: «que ambos botones fueran de las mismas dimensiones». Comparten
	// la caja de .dshem_small: mismo alto, mismo ancho minimo y mismo radio.
	// .dshem_send solo puede cambiar el relleno.
	const fuente = fs.readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
	const base = /\.dshem_small\{([^}]*)\}/.exec(fuente);
	truthy(base, 'regla .dshem_small');
	truthy(base[1].includes('min-width'), 'ancho minimo comun');
	truthy(base[1].includes('border-radius:8px'), 'radio comun');
	truthy(base[1].includes('box-sizing:border-box'), 'misma caja');
	truthy(base[1].includes('border:1px solid'), 'mismo borde');
	const relleno = /\.dshem_send\{([^}]*)\}/.exec(fuente);
	truthy(relleno, 'regla .dshem_send');
	equal(/border-radius/.test(relleno[1]), false, 'el relleno no cambia la forma');
	equal(/padding|min-width|font-size/.test(relleno[1]), false, 'el relleno no cambia el tamano');
});

/* ---------------- mitad del Host ---------------- */
const host = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href);
check('la mitad del Host exporta apply y name', () => {
	equal(typeof host.apply, 'function', 'apply');
	equal(host.name, 'edit-in-place', 'name');
});
check('la mitad del Host no revienta sin logger', () => {
	host.apply({});
	host.apply({ logger: { info: () => {} } });
});

console.log(`\n${passed} comprobaciones correctas, ${failures.length} fallos`);
if (failures.length > 0) {
	for (const failure of failures) console.log(`  - ${failure}`);
	process.exit(1);
}
