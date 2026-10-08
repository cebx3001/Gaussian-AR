// La experiencia se activa únicamente cuando el modelo y sus cámaras están configurados.
import story from './vado-story.json';
const loader = document.getElementById('loader');
const message = document.getElementById('loader-message');
const ready = story.chapters.length > 0 && story.chapters.every(c => c.pose !== null);
async function start() {
  let model = false;
  try { const response = await fetch('./el-vado.sog', { method: 'HEAD' }); model = response.ok; } catch {}
  if (!model || !ready) {
    if (loader) loader.hidden = false;
    if (message) message.textContent = !model ? 'Modelo El Vado pendiente de publicación (el-vado.sog).' : 'Cámaras de El Vado pendientes de calibración.';
    return;
  }
  await import('./vado');
}
void start();
