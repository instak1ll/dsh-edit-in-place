/**
 * Host half of edit-in-place: the one thing the browser cannot do by itself.
 *
 * WHY THIS EXISTS
 * A message that opened a turn has its cut inside the client: the message's own
 * turn carries `turn/start.seq`, and the branch is cut two events before it.
 *
 * A message sent WHILE the agent was answering is different. It enters the turn
 * through an `agent/inbox/spliced` event that the client never sees, and the
 * durable copy the client does see arrives later, after the turn has kept
 * producing assistant messages and tool calls. Measured on a real session:
 *
 *   1351  agent/inbox/spliced next-turn  empty
 *   1352  agent/inbox/spliced next-step  <- the message enters HERE
 *   1354  assistant/message
 *   1355  tool/call
 *   1358  tool/result
 *   1360  agent/inbox/spliced next-step  drained
 *   1362  user/message                   <- the copy the client can see
 *
 * Anything the client can infer falls after 1352, so a branch cut there would
 * carry the original text in its queue and send it again. The log knows the exact
 * position, so the browser asks the Host for it.
 *
 * The route is `GET <prefix>/cut?session=<id>&seq=<n>&id=<uuid>&rpc=<uuid>` and it
 * answers `{ ok: true, atSeq }`, or `{ ok: false, error }` with a readable reason.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

/** Same-origin prefix the browser asks for the cut. */
const PREFIX = '/dsh-edit-in-place';
/** A session log beyond this is not read: a click is not worth a gigabyte. */
const MAX_LOG_BYTES = 64 * 1024 * 1024;
/** Every installed copy of a session log is one of these two names. */
const LOG_NAMES = ['session.v4.jsonl.zstd', 'session.v4.jsonl'];
/** The zstd frame marker DSH writes at the start of every appended block. */
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/**
 * Decompress every chained frame of a session log. DSH appends one zstd frame per
 * block inside the same file, and the platform decoder only returns the first.
 * @param buffer - the whole file.
 * @returns one string per frame, in order.
 */
function framesOf(buffer) {
	const starts = [];
	let from = 0;
	for (;;) {
		const at = buffer.indexOf(MAGIC, from);
		if (at === -1) break;
		starts.push(at);
		from = at + MAGIC.length;
	}
	if (starts.length === 0) return [buffer.toString('utf8')];
	const parts = [];
	for (let index = 0; index < starts.length; index += 1) {
		const stop = starts[index + 1] ?? buffer.length;
		try {
			parts.push(zstdDecompressSync(buffer.subarray(starts[index], stop)).toString('utf8'));
		} catch {
			/* a partial frame at the tail is not fatal: the rest is still readable */
		}
	}
	return parts;
}

/**
 * Parse a session log into events.
 * @param buffer - the whole log file.
 * @returns the events, in order, skipping anything unreadable.
 */
function eventsOf(buffer) {
	const events = [];
	for (const line of framesOf(buffer).join('\n').split('\n')) {
		if (line.trim() === '') continue;
		try {
			events.push(JSON.parse(line));
		} catch {
			/* a torn line is skipped, never fatal */
		}
	}
	return events;
}

/**
 * Index of the durable copy of a message, matched by any identity the client has.
 * @param events - the session events.
 * @param wanted - event seq, message id and request id, any of them.
 * @returns the index, or -1.
 */
function indexOfMessage(events, wanted) {
	if (typeof wanted.seq === 'number') {
		const at = events.findIndex((event) => event.type === 'user/message' && event.seq === wanted.seq);
		if (at !== -1) return at;
	}
	if (typeof wanted.id === 'string' && wanted.id !== '') {
		const at = events.findIndex((event) => event.type === 'user/message' && event.data?.id === wanted.id);
		if (at !== -1) return at;
	}
	if (typeof wanted.rpcId === 'string' && wanted.rpcId !== '') {
		return events.findIndex((event) => event.type === 'user/message' && event.data?.source?.rpcId === wanted.rpcId);
	}
	return -1;
}

/**
 * The last event sequence this branch may keep, or null when it cannot be found.
 *
 * The rule is one line: find the copy, walk back to the `agent/inbox/spliced` that
 * carried it, and keep everything BEFORE that splice. What comes back is the seq of
 * the event immediately before it, which the log guarantees exists.
 * @param events - the session events, in order.
 * @param wanted - event seq, message id and request id of the message to edit.
 * @returns `{ atSeq }` or `{ error }`, both readable by a person.
 */
function findSteeringCut(events, wanted) {
	const durable = indexOfMessage(events, wanted);
	if (durable === -1) return { error: 'that message is not in this session log' };
	for (let index = durable - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event.type !== 'agent/inbox/spliced') continue;
		const inserted = event.data?.inserted;
		if (!Array.isArray(inserted) || inserted.length === 0) continue;
		const before = events[index - 1];
		if (before === undefined) return { error: 'the message entered at the very start of the session' };
		return { atSeq: before.seq };
	}
	return { error: 'no queue entry was found before that message' };
}

/**
 * Find one installed session log without knowing the workspace layout.
 * @param sessionId - the session identity, as the client knows it.
 * @param home - DSH home directory.
 * @returns the log path, or null.
 */
function sessionLogPath(sessionId, home) {
	// A session id looks like `session-<uuid>`. Letters, digits, dashes and underscores
	// only: no slash, no backslash and no dot, so a crafted id can never walk the tree.
	if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(sessionId)) return null;
	const root = join(home, 'sessions');
	if (!existsSync(root)) return null;
	let workspaces;
	try {
		workspaces = readdirSync(root, { withFileTypes: true });
	} catch {
		return null;
	}
	for (const workspace of workspaces) {
		if (!workspace.isDirectory()) continue;
		for (const name of LOG_NAMES) {
			const candidate = join(root, workspace.name, sessionId, name);
			if (existsSync(candidate)) return candidate;
		}
	}
	return null;
}

/**
 * Read a session log and answer the cut.
 * @param sessionId - the session to read.
 * @param wanted - event seq, message id and request id.
 * @param home - DSH home directory.
 * @returns `{ atSeq }` or `{ error }`.
 */
function cutFor(sessionId, wanted, home) {
	const path = sessionLogPath(sessionId, home);
	if (path === null) return { error: 'that session log was not found on disk' };
	let info;
	try {
		const buffer = readFileSync(path);
		if (buffer.length > MAX_LOG_BYTES) return { error: 'that session log is too large to inspect' };
		info = buffer;
	} catch (error) {
		return { error: 'the session log could not be read: ' + (error?.message ?? String(error)) };
	}
	return findSteeringCut(eventsOf(info), wanted);
}

/**
 * Build the HTTP handler for both probes.
 * @param home - DSH home directory.
 * @returns a route handler.
 */
function createHandler(home) {
	return function handle(request, response) {
		// The desktop app is served from `dsh-app://`, so this route is another origin
		// for it. Without these headers the browser drops the answer before the plugin
		// can read it.
		const CORS = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Headers': 'content-type',
			'Access-Control-Allow-Methods': 'GET,OPTIONS',
			'Access-Control-Max-Age': '600',
		};
		const send = (status, value) => {
			const body = Buffer.from(JSON.stringify(value), 'utf8');
			response.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
			response.end(body);
		};
		if (request.method === 'OPTIONS') {
			response.writeHead(204, CORS);
			response.end();
			return;
		}
		let url;
		try {
			url = new URL(request.url ?? '/', 'http://127.0.0.1');
		} catch {
			send(400, { ok: false, error: 'bad request' });
			return;
		}
		if (url.pathname.endsWith('/health')) {
			// No absolute path here. This route answers any page that reaches the local
			// port, and the install path of the user is none of its business.
			send(200, { ok: true, service: 'dsh-edit-in-place' });
			return;
		}
		if (!url.pathname.endsWith('/cut')) {
			send(404, { ok: false, error: 'not found' });
			return;
		}
		const seq = Number(url.searchParams.get('seq'));
		// The answer is one integer, and finding it needs a session identity and an
		// event seq: nothing here describes the user or the contents of a message.
		const answer = cutFor(url.searchParams.get('session') ?? '', {
			seq: Number.isFinite(seq) ? seq : undefined,
			id: url.searchParams.get('id') ?? undefined,
			rpcId: url.searchParams.get('rpc') ?? undefined,
		}, home);
		if (answer.error !== undefined) {
			send(404, { ok: false, error: answer.error });
			return;
		}
		send(200, { ok: true, atSeq: answer.atSeq });
	};
}

/**
 * Activate the plugin on the Host: one route, nothing else.
 * @param ctx - Host context.
 * @param config - optional `home` override, for tests and unusual installs.
 */
function apply(ctx, config) {
	const home = typeof config?.home === 'string' && config.home !== '' ? config.home : process.env.DSH_HOME || join(homedir(), '.dsh');
	const handler = createHandler(home);
	try {
		ctx.inject(['webServer'], (scope) => {
			scope.effect(
				() => scope.webServer.register({ kind: 'prefix', path: PREFIX, handler }),
				'dsh-edit-in-place: cut route',
			);
			ctx.logger?.info?.('dsh-edit-in-place: cut route on ' + PREFIX);
		});
	} catch (error) {
		// Without a web server the browser half still works for every message that
		// opened a turn: only mid-turn editing needs this route.
		ctx?.logger?.warn?.('dsh-edit-in-place: no web server, mid-turn editing stays off: ' + (error?.message ?? String(error)));
	}
}

/** Cordis plugin name. */
const name = 'edit-in-place';

export { apply };
export { name };
export { createHandler };
export { cutFor };
export { eventsOf };
export { findSteeringCut };
export { framesOf };
export { sessionLogPath };
