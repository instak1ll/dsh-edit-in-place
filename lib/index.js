/**
 * Host half of edit-in-place.
 *
 * Nothing in this feature needs the Host. The pencil, the editor and the resend
 * are browser code, and the resend uses the sessions service the program already
 * publishes to the client. This file exists because the `cordis.patch.yml` entry
 * names a Host module and that module has to load cleanly. It stays a silent
 * activator: it logs one line and nothing else.
 *
 * The browser half is `./client.js`.
 */

/**
 * Activate the plugin. It contributes nothing to the Host by design.
 * @param ctx - Host context, used only to leave a trace in the log.
 */
function apply(ctx) {
	try {
		ctx.logger?.info?.('dsh-edit-in-place: activated, the pencil lives in the user message bubble');
	} catch {
		/* a broken logger can never stop the plugin from loading */
	}
}

/** Cordis plugin name. */
const name = 'edit-in-place';

export { apply };
export { name };
