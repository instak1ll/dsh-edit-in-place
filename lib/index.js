/**
 * Host half of «editar mis mensajes».
 *
 * Nada de esta pieza necesita el Host: el boton, el editor y el reenvio son
 * codigo de navegador, y el reenvio usa el servicio de sesiones que el propio
 * programa ya publica al cliente. Este archivo existe porque la entrada de
 * `cordis.patch.yml` nombra un modulo del Host, y ese modulo tiene que cargar
 * limpiamente. Se deja como activador mudo: apunta una linea al registrar y
 * nada mas.
 *
 * El medio navegador esta en `./client.js`.
 */

/**
 * Activar el plugin. No aporta nada al Host por diseno.
 * @param ctx - contexto del Host, solo se usa para dejar constancia.
 */
function apply(ctx) {
	try {
		ctx.logger?.info?.('dsh-edit-in-place: activado, el boton vive en la fila de acciones del turno');
	} catch {
		/* un registro caido no puede impedir que cargue el plugin */
	}
}

/** Nombre Cordis del plugin. */
const name = 'edit-in-place';

export { apply };
export { name };
