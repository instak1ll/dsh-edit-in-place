/**
 * Minimal ASAR reader: list entries and extract one file, without installing
 * anything. The Electron archive format is a Chromium pickle holding a JSON
 * table, followed by the file bodies laid out back to back.
 *
 * Usage:
 *   node tools/asar.mjs list <archive> [substring] [--max=N]
 *   node tools/asar.mjs extract <archive> <entryPath> <outFile>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function openArchive(path) {
	const buffer = readFileSync(path);
	const sizePickle = buffer.readUInt32LE(4);
	const header = buffer.subarray(8, 8 + sizePickle);
	const jsonSize = header.readUInt32LE(4);
	const table = JSON.parse(header.subarray(8, 8 + jsonSize).toString('utf8'));
	return { buffer, table, dataOffset: 8 + sizePickle };
}

function walk(table, prefix, out) {
	for (const [name, node] of Object.entries(table.files ?? {})) {
		const full = prefix === '' ? name : `${prefix}/${name}`;
		if (node.files !== undefined) walk(node, full, out);
		else out.push({ path: full, size: node.size ?? 0, unpacked: node.unpacked === true, offset: node.offset });
	}
}

const [command, archivePath, arg1, arg2] = process.argv.slice(2);
if (!command || !archivePath) {
	console.error('usage: asar.mjs list <archive> [substring] | asar.mjs extract <archive> <entry> <out>');
	process.exit(2);
}
const archive = openArchive(archivePath);

if (command === 'grep') {
	const needle = arg1 ?? '';
	if (needle === '') {
		console.error('grep needs a literal needle');
		process.exit(2);
	}
	const all = [];
	walk(archive.table, '', all);
	const only = process.argv.find((value) => value.startsWith('--path='))?.slice(7) ?? '';
	const limitArg = process.argv.find((value) => value.startsWith('--max='));
	const limit = limitArg === undefined ? 40 : Number(limitArg.slice(6));
	let hits = 0;
	for (const entry of all) {
		if (entry.unpacked || entry.size > 4 * 1024 * 1024) continue;
		if (!/\.(js|mjs|cjs|ts|json|md)$/.test(entry.path)) continue;
		if (only !== '' && !entry.path.includes(only)) continue;
		const start = archive.dataOffset + Number(entry.offset);
		const body = archive.buffer.subarray(start, start + entry.size).toString('utf8');
		const at = body.indexOf(needle);
		if (at === -1) continue;
		hits += 1;
		const from = Math.max(0, at - 160);
		const snippet = body.slice(from, at + needle.length + 160).replace(/\s+/g, ' ');
		console.log(`${entry.path}\n    …${snippet}…`);
		if (hits >= limit) {
			console.log(`(stopped at ${limit} files)`);
			break;
		}
	}
	console.log(`files with the needle: ${hits}`);
} else if (command === 'list') {
	const all = [];
	walk(archive.table, '', all);
	const needle = (arg1 ?? '').toLowerCase();
	const limitArg = process.argv.find((value) => value.startsWith('--max='));
	const limit = limitArg === undefined ? 400 : Number(limitArg.slice(6));
	const hits = all.filter((entry) => needle === '' || entry.path.toLowerCase().includes(needle));
	console.log(`entries: ${all.length} · matching "${needle}": ${hits.length}`);
	for (const entry of hits.slice(0, limit)) console.log(`${String(entry.size).padStart(9)}  ${entry.unpacked ? 'U' : ' '}  ${entry.path}`);
} else if (command === 'extract') {
	if (!arg1 || !arg2) {
		console.error('extract needs <entry> <out>');
		process.exit(2);
	}
	const all = [];
	walk(archive.table, '', all);
	const hit = all.find((entry) => entry.path === arg1);
	if (hit === undefined) {
		console.error(`not found: ${arg1}`);
		process.exit(1);
	}
	if (hit.unpacked) {
		console.error(`entry is unpacked, read it at app.asar.unpacked/${arg1}`);
		process.exit(1);
	}
	const start = archive.dataOffset + Number(hit.offset);
	const body = archive.buffer.subarray(start, start + hit.size);
	mkdirSync(dirname(arg2), { recursive: true });
	writeFileSync(arg2, body);
	console.log(`wrote ${arg2} (${body.length} bytes)`);
} else {
	console.error(`unknown command: ${command}`);
	process.exit(2);
}
