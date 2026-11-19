/**
 * Editar un mensaje propio ya enviado y reenviarlo, al estilo de Gemini.
 *
 * COMO SE EDITA
 * En el sitio. No hay dialogo encima: al pulsar el lapiz (o al hacer clic en el
 * texto del mensaje, si no estas seleccionando nada) la burbuja se convierte en
 * una caja de texto en su mismo hueco, y debajo aparecen Cancelar y Reenviar.
 * Enter reenvia, Mayus+Enter salta de linea, Esc cancela.
 *
 * DONDE VIVE EL LAPIZ
 * En TU mensaje. DSH no declara asientos hijos dentro de la burbuja del usuario,
 * pero el catalogo del asiento `conversation.chat.node` dice: «Registering an
 * already-occupied key replaces that occupant». Asi que este plugin ocupa la
 * clave `user` y pinta la misma burbuja que pintaba el programa, con la edicion
 * incorporada.
 *
 * POR QUE NO SE VE DISTINTO
 * Se usan a la vez las MISMAS clases del programa (modulo MessageItem) y unas
 * propias con las reglas copiadas literalmente de las suyas: si el programa
 * cambia su prefijo, las nuestras sostienen el estilo. Los glifos y las
 * utilidades de las primitivas van con respaldo, para que un cambio de
 * exportaciones no deje el mensaje en blanco.
 *
 * QUE HACE AL REENVIAR
 * No reescribe el historial (DSH es un registro de eventos y nada se borra):
 * pide al Host una RAMA cortada antes de ese mensaje, la abre y manda alli el
 * texto corregido. La conversacion original queda intacta.
 *
 * DONDE CORTA, CON PRUEBA
 * Sondeo de logs reales con `tools/eventos.mjs`:
 *
 *   turno 1:  ... 2 cabecera | 3 inbox/spliced (entra TU mensaje) | 4 turn/start 1 ...
 *   turno N:  ... turn/end N-1 | inbox/spliced (entra TU mensaje) | turn/start N ...
 *
 * Validado contra un caso real: editar «TEST» del turno 4 y reenviarlo como
 * «TEST EDITADO» corto en el `turn/end` del turno 3 y dejo la original intacta.
 */

window.__ModuleLoader__.load({
	id: 'dsh-edit-in-place',
	factory: (require) => {
		const module = { exports: {} };
		const exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
		const react = require('react');
		const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
		//#region dsh-edit-in-place/EditarMensaje.module.css
		const css = `
/* Burbuja del usuario: copia literal de las reglas del programa, con nombre
   propio para no depender de su prefijo. Los valores son los suyos, no inventados. */
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
/* Fila de acciones: mismas medidas que la del programa, con el lapiz delante. */
.dshem_uactions{height:calc(28px + var(--dsh-content-font-delta,0px));align-items:center;gap:8px;display:flex;justify-content:flex-end}
.dshem_uaction{width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));border-radius:var(--dsw-radius-sm,6px);color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;justify-content:center;align-items:center;padding:6px;display:inline-flex}
.dshem_uaction svg{width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px))}
.dshem_uaction:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));color:var(--dsw-alias-label-secondary)}
.dshem_uaction:disabled{opacity:.45;cursor:default}
.dshem_uaction:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dshem_utime{font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);white-space:nowrap}
/* Edicion en el sitio: la burbuja se vuelve caja de texto, y la caja ocupa el
   ancho de la columna (no el ancho estrecho de la burbuja), como la referencia. */
.dshem_editWrap{width:100%;display:flex;flex-direction:column;gap:8px}
.dshem_editBox{display:block;width:100%;box-sizing:border-box;min-height:64px;max-height:44vh;resize:vertical;background:var(--dsw-specific-bubble);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xl);color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));padding:10px 16px;white-space:pre-wrap;word-break:break-word}
.dshem_editBox:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dshem_editRow{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;max-width:100%}
.dshem_editNote{margin-right:auto;font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-tertiary)}
.dshem_editError{margin:0;font-size:12.5px;line-height:1.45;color:var(--dsw-alias-state-error-primary);white-space:pre-wrap;text-align:right}
.dshem_small{padding:5px 12px;min-width:118px;text-align:center;box-sizing:border-box;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.dshem_small:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}
.dshem_small:disabled{opacity:.5;cursor:default}
.dshem_small:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
/* Misma caja que Cancelar: mismo alto, mismo ancho minimo y mismo radio. Solo
   cambia el relleno. El par de colores se copia del boton de enviar del programa:
   con --dsw-alias-brand-primary la etiqueta se volvia invisible en tema oscuro. */
.dshem_send{background:var(--dsw-alias-button-info-fill,#3b6fd4);border-color:transparent;color:#fff;font-weight:500}
.dshem_send:hover:not(:disabled){background:var(--dsw-alias-button-info-hover,var(--dsw-alias-button-info-fill,#3b6fd4));filter:none}
`;
		const tagId = 'dsh-edit-in-place/EditarMensaje.module.css';
		if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
			const tag = document.createElement('style');
			tag.dataset.plugin = 'dsh-edit-in-place';
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		/** Clases del programa, para heredar su hoja de estilos tal cual. */
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
		/** Clases propias, con las mismas reglas, para no depender de ese prefijo. */
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
		 * Las dos clases a la vez: la copia del programa y la nuestra.
		 * @param key - nombre logico de la clase.
		 * @returns la lista de clases separadas por espacio.
		 */
		function both(key) {
			return SHIPPED[key] + ' ' + MINE[key];
		}

		/** Milisegundos que se espera a que la rama nueva abra antes de rendirse. */
		const OPEN_TIMEOUT_MS = 20000;
		/** Milisegundos entre sondeos del binding de la rama. */
		const OPEN_POLL_MS = 120;
		/** Pixeles de arrastre que ya no son un clic, para no editar al seleccionar. */
		const DRAG_TOLERANCE = 4;

		/**
		 * Abrir una sesion en la vista principal. Se rellena cuando el cliente
		 * tiene `uiWorkspace`, que es opcional: sin el, la rama se crea igual.
		 */
		let navigateTo = null;

		/**
		 * Leer un servicio sin romper cuando no esta inyectado. Cordis lanza
		 * «cannot get property ... without inject» al tocar uno que no se declaro,
		 * asi que aqui se prueba y se devuelve undefined en vez de propagar.
		 * @returns el servicio, o undefined.
		 */
		function serviceOf(ctx, key) {
			if (ctx === null || ctx === undefined) return undefined;
			try {
				const direct = ctx[key];
				if (direct !== undefined && direct !== null) return direct;
			} catch {
				/* no inyectado: se intenta por ctx.get */
			}
			try {
				return ctx.get?.(key);
			} catch {
				return undefined;
			}
		}

		/**
		 * Trocear el contenido de un mensaje igual que el programa.
		 * @param content - bloques del mensaje.
		 * @returns texto, adjuntos y bloques raros.
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
		 * `start.seq` del turno, buscado en el propio turno y en su ubicacion.
		 * @returns el seq, o undefined.
		 */
		function startSeqOf(...candidates) {
			for (const candidate of candidates) {
				const seq = candidate?.start?.seq;
				if (typeof seq === 'number' && Number.isFinite(seq)) return seq;
			}
			return undefined;
		}

		/**
		 * `end.seq` del turno, que es un `turn/end` real del log.
		 * @returns el seq, o undefined.
		 */
		function endSeqOf(turn) {
			const seq = turn?.end?.seq;
			return typeof seq === 'number' && Number.isFinite(seq) ? seq : undefined;
		}

		/**
		 * Coleccion del snapshot que se comporta como Map sin exigir su prototipo.
		 * @returns la coleccion, o null.
		 */
		function asMap(value) {
			if (value === null || typeof value !== 'object') return null;
			if (typeof value.get !== 'function' || typeof value.values !== 'function') return null;
			return value;
		}

		/**
		 * Situar el turno de un mensaje dentro del historial y decidir donde cortar.
		 * @param snapshot - snapshot del chat (`useChat`).
		 * @param turnLocation - `node.location.turn` del mensaje.
		 * @param seq - `node.data.seq` del mensaje.
		 * @returns numero de turno y corte, o null.
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
				// Primer turno: su mensaje entra en el `spliced` de `start.seq - 1`, asi que
				// el ultimo corte limpio es `start.seq - 2` (una cabecera de la sesion).
				else if (startSeq !== undefined && startSeq >= 2) atSeq = startSeq - 2;
				return { number, turn, previousNumber: position > 0 ? order[position - 1] : null, atSeq, first: previous === undefined };
			} catch {
				return null;
			}
		}

		/**
		 * Selector estable del corte de la rama.
		 * @returns el seq de corte, o null.
		 */
		function selectBoundary(snapshot, turnLocation, seq) {
			const located = locateTurn(snapshot, turnLocation, seq);
			return located === null ? null : located.atSeq;
		}

		/**
		 * Esperar sin bloquear el hilo.
		 * @returns una promesa que se resuelve al vencer.
		 */
		function sleep(ms) {
			return new Promise((resolve) => setTimeout(resolve, ms));
		}

		/**
		 * Estado de apertura de un binding, sin fiarse de su forma.
		 * @returns el estado como cadena.
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
		 * Esperar a que la rama abra y devolver su binding vivo.
		 * @param sessions - servicio `sessions` del cliente.
		 * @param sessionId - id de la rama.
		 * @param budgetMs - espera maxima.
		 * @returns el binding listo para mandar el mensaje.
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
					if (state === 'error') throw new Error('la rama se creo pero no se pudo abrir');
				}
				if (Date.now() >= until) {
					if (binding !== undefined) return binding;
					throw new Error('la rama tardo demasiado en abrirse, intentalo otra vez');
				}
				await sleep(OPEN_POLL_MS);
			}
		}

		/**
		 * Crear la rama y mandar alli el texto corregido.
		 * @param ctx - contexto del cliente (dueno de `sessions` y `uiWorkspace`).
		 * @param options - sesion de origen, corte exacto y texto nuevo.
		 * @returns el id de la rama creada.
		 */
		async function resendInFork(ctx, options) {
			const sessions = serviceOf(ctx, 'sessions');
			if (sessions === undefined || typeof sessions.fork !== 'function') {
				throw new Error('el servicio de sesiones no esta disponible');
			}
			const sessionId = options.sessionId;
			const atSeq = options.atSeq;
			const text = String(options.text ?? '').trim();
			if (typeof sessionId !== 'string' || sessionId === '') throw new Error('no se sabe de que conversacion editar');
			if (typeof atSeq !== 'number' || !Number.isFinite(atSeq) || atSeq < 0) throw new Error('no hay un punto limpio donde cortar la conversacion');
			if (text === '') throw new Error('el mensaje esta vacio');
			const childId = await sessions.fork({ sessionId, atSeq, increaseTitle: true });
			if (typeof childId !== 'string' || childId === '') throw new Error('el Host no devolvio la rama nueva');
			const navigate = typeof options.navigate === 'function' ? options.navigate : navigateTo;
			if (typeof navigate === 'function') {
				try {
					navigate(childId);
				} catch {
					/* la rama existe aunque la vista no salte sola */
				}
			}
			const binding = await waitForBinding(sessions, childId, options.timeoutMs ?? OPEN_TIMEOUT_MS);
			const result = await binding.session.prompt([{ type: 'text', text }], 'queue');
			if (result === null || typeof result !== 'object' || result.ok !== true) {
				const detail = result?.error?.message;
				throw new Error(typeof detail === 'string' && detail !== '' ? detail : 'el Host rechazo el mensaje');
			}
			return childId;
		}

		/** Mensaje que se esta editando ahora mismo, compartido entre suscriptores. */
		const store = {
			editing: null,
			listeners: new Set(),
		};

		/** Avisar a todo el que escuche que el editor cambio. */
		function emit() {
			for (const listener of [...store.listeners]) {
				try {
					listener();
				} catch {
					/* un suscriptor roto no puede cerrar el editor de los demas */
				}
			}
		}

		/**
		 * Abrir la edicion de un mensaje concreto.
		 * @param payload - identidad del mensaje, sesion, corte, texto y turno.
		 */
		function openEditor(payload) {
			store.editing = payload;
			emit();
		}

		/** Cerrar la edicion sin mandar nada. */
		function closeEditor() {
			if (store.editing === null) return;
			store.editing = null;
			emit();
		}

		/**
		 * Saber si hay una edicion abierta (y cual) desde React.
		 * @returns el mensaje en edicion, o null.
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

		/** Lapiz, dibujado aqui porque las primitivas no traen este glifo. */
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
		 * Glifo de copiar: el del programa si esta, y uno propio si falta.
		 * @param props - si acaba de copiarse.
		 * @returns el glifo.
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
		 * Hora del mensaje, con fecha si no es de hoy.
		 * @param time - marca de tiempo del mensaje.
		 * @returns la hora corta.
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
		 * Texto plano de un mensaje, para copiar y para editarlo.
		 * @param node - nodo del mensaje.
		 * @returns el texto.
		 */
		function messageText(node) {
			return contentParts(node?.data?.content).text;
		}

		/**
		 * Tu mensaje: burbuja normal, o caja de texto en el mismo hueco cuando se
		 * esta editando, con su lapiz en la fila de acciones.
		 * @param props - moneda del asiento, kit de sesion y el corte ya resuelto.
		 * @returns la fila del mensaje.
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
			// null = la caja aun no se ha tocado: se enseña el texto del mensaje, se
			// monte cuando se monte. Asi una caja que nace en modo edicion nunca sale
			// vacia, que seria perder tu mensaje.
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
			const canEdit = typeof props.atSeq === 'number' && props.atSeq >= 0 && parts.text !== '' && typeof props.sessionId === 'string';
			const editing = open !== null && typeof node?.key === 'string' && open.key === node.key;
			const draftText = draft !== null ? draft : editing === true ? String(open.text ?? '') : parts.text;
			react.useEffect(() => {
				if (editing !== true) return;
				const area = areaRef.current;
				if (area === null || area === undefined) return;
				area.focus();
				area.setSelectionRange(area.value.length, area.value.length);
			}, [editing]);
			const reason = canEdit
				? 'Editar y reenviar este mensaje'
				: parts.text === ''
					? 'Este mensaje no tiene texto que editar'
					: 'No hay un punto limpio donde ramificar desde este mensaje';
			const turnNumber = node?.location?.turn?.turn;
			const begin = react.useCallback(() => {
				if (canEdit !== true) return;
				setDraft(null);
				setPhase('idle');
				setError('');
				openEditor({
					key: node?.key,
					sessionId: props.sessionId,
					atSeq: props.atSeq,
					text: parts.text,
					turnNumber: typeof turnNumber === 'number' ? turnNumber : undefined,
				});
			}, [canEdit, node?.key, props.sessionId, props.atSeq, parts.text, turnNumber]);
			const send = react.useCallback(async () => {
				const text = String(draftText ?? '').trim();
				if (text === '' || phase === 'sending') return;
				setPhase('sending');
				setError('');
				try {
					const ctx = clientContext;
					if (ctx === null) throw new Error('el plugin no esta conectado al cliente');
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
			/** Un clic sin arrastre y sin seleccion abre la edicion, como pedir el texto. */
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
				begin();
			}, [canEdit, begin]);
			if (editing === true) {
				const sending = phase === 'sending';
				return react.createElement('div', { className: 'dshem_editWrap', 'data-editar-mensaje': 'mensaje' },
					react.createElement('textarea', {
						ref: areaRef,
						className: 'dshem_editBox',
						value: draftText,
						rows: 3,
						spellCheck: false,
						disabled: sending,
						title: 'Enter actualiza · Mayús+Enter salta de línea · Esc cancela',
						'aria-label': 'Tu mensaje',
						'data-editar-mensaje': 'texto',
						onChange: (event) => setDraft(event.target.value),
						onKeyDown,
					}), error === '' ? null : react.createElement('p', { className: 'dshem_editError', role: 'status', 'data-editar-mensaje': 'error' }, error),
					react.createElement('div', { className: 'dshem_editRow' },
						react.createElement('span', { className: 'dshem_editNote' }, 'Se abre una rama: esta conversación no cambia'),
						react.createElement('button', {
							type: 'button',
							className: 'dshem_small',
							disabled: sending,
							'data-editar-mensaje': 'cancelar',
							onClick: closeEditor,
						}, 'Cancelar'),
						react.createElement('button', {
							type: 'button',
							className: 'dshem_small dshem_send',
							disabled: sending || String(draftText ?? '').trim() === '',
							'data-editar-mensaje': 'reenviar',
							onClick: () => {
								void send();
							},
						}, sending ? 'Actualizando…' : 'Actualizar')));
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
							label: 'Bloque extra',
							payload: block,
							truncatedLabel: (total) => 'recortado (' + total + ')',
						}));
					});
				}
				children.push(react.createElement('div', {
					key: 'bubble',
					className: both('bubble'),
					title: canEdit ? 'Pulsa para editar este mensaje' : undefined,
					onMouseDown: onBubbleMouseDown,
					onMouseUp: onBubbleMouseUp,
				}, react.createElement(react.Fragment, null, body), extras));
			}
			if (referenceLabels.length > 0) {
				children.push(react.createElement('div', { key: 'references', className: both('referenceSummary') },
					'Referencias: ' + referenceLabels.join(' · ')));
			}
			const actions = react.createElement('div', { className: 'dshem_uactions', 'data-editar-mensaje': 'acciones' },
				react.createElement('button', {
					type: 'button',
					className: 'dshem_uaction',
					'aria-label': reason,
					title: reason,
					disabled: canEdit ? undefined : true,
					'data-editar-mensaje': 'lapiz',
					onClick: begin,
				}, react.createElement(PencilIcon, null)),
				react.createElement('span', { className: 'dshem_utime' }, clockText(data.time)),
				react.createElement('button', {
					type: 'button',
					className: 'dshem_uaction',
					'aria-label': copied ? 'Copiado' : 'Copiar el mensaje',
					title: copied ? 'Copiado' : 'Copiar',
					'data-editar-mensaje': 'copiar',
					onClick: copy,
				}, react.createElement(CopyIcon, { copied })));
			return react.createElement('div', { className: both('userRow'), 'data-editar-mensaje': 'mensaje' },
				react.createElement('div', { className: both('userStack') }, children),
				actions);
		}

		/**
		 * Con snapshot: busca el corte del turno al que pertenece el mensaje.
		 * @param props - props del asiento.
		 * @returns la burbuja con su lapiz.
		 */
		function UserMessageWithStore(props) {
			const node = props.node;
			const atSeq = props.useChat((snapshot) => selectBoundary(snapshot, node?.location?.turn, node?.data?.seq));
			return react.createElement(UserMessageBubble, { ...props, atSeq });
		}

		/**
		 * Elegir camino: los hooks no se pueden llamar a medias, por eso la decision
		 * se toma antes de montar el componente que los usa.
		 * @param props - props del asiento.
		 * @returns la burbuja, con o sin lapiz.
		 */
		function UserMessageNode(props) {
			if (typeof props.useChat === 'function') return react.createElement(UserMessageWithStore, props);
			return react.createElement(UserMessageBubble, { ...props, atSeq: null });
		}

		/** Contexto del cliente, para que la edicion pueda hablar con el Host. */
		let clientContext = null;

		/**
		 * Servicios que el cliente debe tener listos antes de montar el lapiz.
		 * `sessions` es obligatorio: Cordis no deja leer un servicio que el plugin no
		 * declara, y sin el no hay rama. `uiWorkspace` es opcional y se pide aparte.
		 */
		const inject = ['slots', 'sessions'];

		/**
		 * Montar el plugin en el navegador: la burbuja de tus mensajes, editable en
		 * su sitio, con el lapiz en su fila de acciones.
		 * @param ctx - contexto raiz del cliente.
		 */
		function apply(ctx) {
			clientContext = ctx;
			ctx.effect(() => () => {
				clientContext = null;
				closeEditor();
			}, 'dsh-edit-in-place: cerrar la edicion al descargar');
			try {
				ctx.inject(['uiWorkspace'], (scope) => {
					const workspace = scope.uiWorkspace;
					navigateTo = (sessionId) => {
						try {
							workspace.openSession(sessionId);
						} catch {
							/* la rama existe aunque la vista no salte sola */
						}
					};
				});
			} catch {
				/* composicion sin vista de workspace: la rama se crea igual */
			}
			ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
				name: 'conversation.chat.node',
				key: 'user',
			}, UserMessageNode));
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.__internals = {
			contentParts,
			serviceOf,
			locateTurn,
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
