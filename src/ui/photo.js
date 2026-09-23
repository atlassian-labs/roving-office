// Copy a photo of the scene to the clipboard.
//
// "Without any panels" needs no work: the panels are DOM overlays sitting on top of
// the canvas, so a photo *of the canvas* is already the room and nothing else.
//
// The catch is `preserveDrawingBuffer`. The renderer is built without it — the
// default, and the right default, since keeping every frame's buffer around costs
// memory and bandwidth on every one of them for a feature used once in a session.
// The consequence is that the drawing buffer is undefined after the frame ends, so
// a `toBlob` on the next tick reliably returns a blank image.
//
// So the fix is to render on demand and capture in the same turn of the event loop,
// before the browser gets a chance to clear anything. Nothing may await between the
// render and the read — `toBlob` itself is fine, because it snapshots synchronously
// and only the encoding is deferred.

/**
 * Render one frame and put it on the clipboard as a PNG.
 *
 * @param {object} opts
 * @param {THREE.WebGLRenderer} opts.renderer
 * @param {THREE.Scene} opts.scene
 * @param {() => THREE.Camera} opts.camera  the camera in use right now
 * @returns {Promise<boolean>} whether it reached the clipboard
 */
export async function copySceneToClipboard({ renderer, scene, camera }) {
  // Clipboard images need a secure context. Over plain http on anything but
  // localhost the API is simply absent, which is worth saying out loud rather than
  // failing with an undefined property.
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    console.warn('photo: the clipboard API needs a secure context (https, or localhost).');
    return false;
  }

  const blob = await new Promise((resolve) => {
    // Render and read back-to-back. See the note above on preserveDrawingBuffer.
    renderer.render(scene, camera());
    renderer.domElement.toBlob(resolve, 'image/png');
  });
  if (!blob) return false;

  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch (err) {
    // Denied permission, or a document that was not focused when the write landed.
    console.warn('photo: could not write to the clipboard.', err);
    return false;
  }
}
