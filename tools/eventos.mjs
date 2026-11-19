/**
 * Print the first N events of a DSH session log, in order, with only the fields
 * that matter for placing a fork boundary: seq, type, and a short payload hint.
 *
 * DSH writes one zstd frame per appended block, chained in the same file, so the
 * frames are walked one by one: zstdDecompressSync only returns the first.
 *
 * Usage: node tools/eventos.mjs <session.v4.jsonl.zstd> [count]
 */
import { readFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function frames(buffer) {
	const starts = [];
	let from = 0;
	for (;;) {
		const at = buffer.indexOf(MAGIC, from);
		if (at === -1) break;
		starts.push(at);
		from = at + MAGIC.length;
	}
	const parts = [];
	for (let index = 0; index < starts.length; index += 1) {
		const stop = starts[index + 1] ?? buffer.length;
		try {
			parts.push(zstdDecompressSync(buffer.subarray(starts[index], stop)).toString('utf8'));
		} catch {
			/* a partial frame at the tail is not fatal for a probe */
		}
	}
	return parts;
}

const [, , path, countArg] = process.argv;
if (!path) {
	console.error('usage: node tools/eventos.mjs <session.v4.jsonl.zstd> [count|--skeleton]');
	process.exit(2);
}
const skeleton = countArg === '--skeleton' || process.argv.includes('--skeleton');
const SKELETON = new Set(['turn/start', 'turn/end', 'agent/inbox/spliced', 'user/message', 'steering/message']);
const limit = skeleton ? 400 : Number(countArg ?? 24);
const text = frames(readFileSync(path)).join('');
let shown = 0;
for (const line of text.split('\n')) {
	if (line.trim() === '') continue;
	let event;
	try {
		event = JSON.parse(line);
	} catch {
		continue;
	}
	const data = event.data ?? {};
	if (skeleton && !SKELETON.has(event.type)) continue;
	const hint =
		event.type === 'user/message'
			? JSON.stringify((data.content ?? []).map((part) => part.text ?? part.type).join(' ')).slice(0, 70)
			: event.type === 'agent/inbox/spliced'
				? `target=${data.target} inserted=${(data.inserted ?? []).length}`
				: event.type === 'turn/start' || event.type === 'turn/end' || event.type === 'step/start' || event.type === 'step/end'
					? `turn=${data.turn}${data.step === undefined ? '' : ` step=${data.step}`}`
					: '';
	console.log(`${String(event.seq).padStart(4)}  ${event.type}${hint === '' ? '' : `   ${hint}`}`);
	shown += 1;
	if (shown >= limit) break;
}
