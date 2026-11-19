# dsh-edit-in-place

**Edita un mensaje que ya enviaste — en el sitio — y vuelve a mandarlo.** La
conversación original se queda exactamente como estaba.

Un plugin para [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
Read this in [English](README.md).

> Todavía no hay captura en este README. Si lo instalas, manda una: merece verse
> en vez de describirse.

## Qué hace

Tus mensajes llevan un lápiz al lado de la hora y del botón de copiar. Pulsas el
lápiz, o haces clic en el texto del propio mensaje, y la burbuja se convierte en
una caja de texto **en su mismo hueco**: no se abre nada encima de nada.

```
       HOLAAAA, cambiate esto                 <- tu mensaje
       lapiz · 20:21 · copiar                 <- su fila de acciones
                    ↓ pulsas el lapiz
 ┌──────────────────────────────────────┐
 │ HOLAAAA, cambiate esto, y ademas...  │     <- mismo sitio, ya editable
 └──────────────────────────────────────┘
 Se abre una rama: esta conversación no cambia
                        [ Cancelar ] [ Actualizar ]
```

- **Enter** envía, **Mayús+Enter** salta de línea, **Escape** cancela.
- Un arrastre o un texto seleccionado **no** entran en edición: solo un clic limpio.
- Los dos botones miden y se redondean igual. El relleno toma sus colores del
  botón de enviar del propio editor.

## Por qué una rama y no una reescritura

DeepSeek Harness es un registro de eventos: nunca se borra nada. Así que «volver
atrás y editar» no puede significar «tachar lo que vino después». En su lugar el
plugin pide al Host una **rama** cortada justo antes de tu mensaje, la abre y
manda allí el texto corregido.

- Tu conversación original no se modifica nunca. Se queda en la barra lateral.
- La rama hereda todo el prefijo y sigue con tu texto nuevo.

Es el equivalente honesto de lo que hacen ChatGPT y Gemini, y no necesita parchear
el Host, ni endpoints nuevos, ni reescribir eventos del log.

## Dónde corta la historia, con prueba

Medido sobre logs de sesión reales (`tools/eventos.mjs` los imprime en orden — DSH
escribe un fotograma zstd por bloque añadido, encadenados dentro del mismo
fichero):

```
turno 1:  ... 2 cabecera | 3 inbox/spliced (entra tu mensaje) | 4 turn/start 1 ...
turno N:  ... turn/end N-1 | inbox/spliced (entra tu mensaje) | turn/start N ...
```

- **Turno N** → corte en el `turn/end` del turno N-1. El prefijo acaba en un turno
  cerrado y **no** arrastra el mensaje encolado de este.
- **Turno 1** → corte en `turn/start.seq - 2`, la última cabecera de la sesión.
  Cortar una posición antes se comería el `spliced` que lleva tu primer mensaje,
  y el texto viejo volvería a enviarse dentro de la rama.

Confirmado en un caso real: editar `TEST` del turno 4 y mandarlo como
`TEST EDITADO` cortó en el `turn/end` del turno 3, y la original sigue diciendo
`TEST`.

## Cómo se coloca en la interfaz

DeepSeek Harness no declara asientos hijos dentro de la burbuja del mensaje de
usuario, así que el lápiz no se puede añadir con un punto de extensión normal. Lo
que sí permite es reemplazar el renderizador de un nodo del chat por su clave, y
el catálogo de asientos lo dice con estas palabras:

> Registering an already-occupied key replaces that occupant.

Así que el plugin ocupa la clave `user` de `conversation.chat.node` y pinta la
misma burbuja que pintaba el programa, con la edición incorporada.

Para que esa burbuja sea idéntica se usan dos cosas a la vez:

- las **clases del propio programa** (módulo `MessageItem`), para heredar su hoja
  de estilos tal cual;
- **clases propias de este plugin con copia de esas mismas reglas CSS**, para que
  si el programa cambia algún día su prefijo, la burbuja siga viéndose bien.

Cada primitiva (`projectUserText`, `FileTypeIcon`, `JsonBlock`, el glifo de
copiar, `writeClipboard`) se resuelve con respaldo: si una exportación
desaparece, el mensaje se sigue pintando, y nunca en blanco.

## Instalación

El paquete declara `dsh.bundle.patch`, así que el parche del perfil se escribe
solo. **SIN VERIFICAR:** no pude ejecutar `dsh plugin add` en la máquina donde se
construyó esto (la app de escritorio no tiene el binario `dsh` en el PATH). Si no
funciona, usa la opción 2.

**1. Desde GitHub**

```bash
dsh plugin --profile web add github:instak1ll/dsh-edit-in-place
```

Después reinicia DeepSeek Harness y recarga la página.

**2. A mano, siempre funciona**

Copia esta carpeta donde quieras y añade a
`$DSH_HOME/profiles/<perfil>/cordis.patch.yml`:

```yaml
- insert:
    - id: edit-in-place
      name: "C:\\ruta\\a\\dsh-edit-in-place\\lib\\index.js"
```

Reinicia DeepSeek Harness. La composición de plugins se arma al arrancar, así que
recargar la página no basta para una entrada nueva.

**3. Como dependencia local**

Pon la carpeta en el árbol de dependencias del perfil y usa
`name: "dsh-edit-in-place"` en el parche de arriba en vez de una ruta.

## Compruébalo tú

```bash
node tools/verificar.mjs
```

35 comprobaciones, sin navegador, y no es un simulacro. El script carga el
`lib/client.js` real, ejecuta su `apply()` contra un cliente falso que **imita las
prohibiciones de Cordis** (leer un servicio no declarado lanza), y recorre el
camino de verdad — burbuja, lápiz, edición en el sitio, Enter, Escape, enviar —
llamando a los mismos componentes que llamaría React. Las cifras del fixture (4,
8, 218, 220, 375) salen de un log real.

Dos guardianes leen el CSS: uno falla si el botón de confirmar vuelve a emparejar
el acento de marca con etiqueta blanca (salía invisible en tema oscuro), y otro
falla si se diferencia de Cancelar en forma o tamaño.

Herramientas, útiles por sí mismas:

- `tools/asar.mjs` — listar, extraer y buscar dentro de un `app.asar` de Electron
  sin instalar nada: `node tools/asar.mjs grep <archivo> <texto>`
- `tools/eventos.mjs` — imprimir los eventos de un log de sesión en orden:
  `node tools/eventos.mjs <sesion.v4.jsonl.zstd> --skeleton`

## Limitaciones, sin adornos

- **Siempre rama.** Sin rama no hay función: DSH no borra eventos del log.
- **Solo el mensaje que abrió el turno.** Un `steering` a mitad de turno conserva
  el renderizador del programa y no tiene lápiz.
- **Solo texto.** Los adjuntos del mensaje original no viajan a la rama.
- **La línea de referencias es mía.** Cuando un mensaje usa `@archivo`, la burbuja
  dice `Referencias: …` en vez de la redacción del programa.
- **Reemplaza el renderizador oficial del usuario.** Si DeepSeek cambia la forma de
  ese nodo, la burbuja puede quedarse atrás hasta que este plugin se actualice. Las
  clases de respaldo lo amortiguan, no lo eliminan.
- **Probado contra DeepSeek Harness 0.2.0-rc.2** (escritorio). Versiones anteriores
  o posteriores, sin probar.

## Trabajo relacionado

Otros tres plugins tocan la misma idea, y este no es el primero:

- [dsh-edit-message](https://github.com/2648782102/dsh-edit-message) — edita y
  reenvía un mensaje propio, incluso mientras el agente está respondiendo.
- [dsh-msg-edit](https://github.com/moton16/dsh-msg-edit) — edita añadiendo
  eventos `surface-replace` al log, con endpoints RPC en el Host. Su propio README
  deja **fuera de alcance la edición en línea del mensaje de usuario**, porque
  considera que el asiento del renderizador está ocupado por la interfaz oficial, y
  documenta tres comportamientos del Host que tiene que sortear.
- `dsh-edit-resend` en npm.

La diferencia aquí es estrecha y deliberada: **no se reescribe nada del log y no se
parchea nada**, la edición ocurre dentro de tu propia burbuja, y la original sigue
legible.

## Licencia

MIT © Артём Гладков ([instak1ll](https://github.com/instak1ll))
