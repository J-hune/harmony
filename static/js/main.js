import { io } from 'socket.io';

import { LayerManager } from './layers.js';
import { PaletteManager } from './palettes.js';
import { ThreeSceneManager } from './three.js';
import { StatusManager } from './status.js';

// Taille maximale de l'image encodée (doit rester sous MAX_HTTP_BUFFER_SIZE côté serveur)
const MAX_IMAGE_DATA_LENGTH = 5 * 1024 * 1024;
// Nombre maximal de pixels, fixé par le serveur (MAX_IMAGE_PIXELS) et transmis dans la page
const MAX_IMAGE_PIXELS = Number(document.body.dataset.maxImagePixels);

/** Mégapixels au format français (« 3,0 », « 2 »). */
const mpx = (pixels, digits) =>
   (digits === undefined ? String(pixels / 1e6) : (pixels / 1e6).toFixed(digits)).replace('.', ',');
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Variables globales
let socket;
// Passe à true quand toutes les couches sont reçues : l'harmonisation est lancée
// dès que le serveur a fini le traitement de l'image (événement thinking=false).
let autoHarmonizePending = false;
// Les couches arrivent compressées : on les décode une par une, dans l'ordre.
// Le numéro de génération invalide les couches d'une image précédente.
let layerQueue = Promise.resolve();
let layerGeneration = 0;
const paletteManager = new PaletteManager();
const layerManager = new LayerManager();
const threeSceneManager = new ThreeSceneManager(paletteManager, layerManager);
const statusManager = new StatusManager();

const $ = (id) => document.getElementById(id);

// Initialisation des managers et de la connexion Socket.IO
threeSceneManager.init();
initWebFeatures();

// Connexion Socket.IO, à la même adresse que la page (chemin /socket.io/)
socket = io();
initSocket();

/**
 * Initialise la connexion Socket.IO et définit les gestionnaires d'événements.
 */
function initSocket() {
   let hasConnectedOnce = false;
   let isThinking = false;
   let lastHeartbeatAt = Date.now();
   let heartbeatTimer = null;

   const nowTag = () => new Date().toLocaleTimeString('fr-FR', { hour12: false });
   const transportName = () => socket?.io?.engine?.transport?.name || 'unknown';

   const stopClientHeartbeat = () => {
      if (heartbeatTimer !== null) {
         clearInterval(heartbeatTimer);
         heartbeatTimer = null;
      }
   };

   const startClientHeartbeat = () => {
      stopClientHeartbeat();
      heartbeatTimer = setInterval(() => {
         const elapsedSec = Math.floor((Date.now() - lastHeartbeatAt) / 1000);
         const phase = isThinking ? 'calcul en cours' : 'connexion idle';
         console.info(
            `%c[${nowTag()}] heartbeat client%c ${phase} | transport=${transportName()} | +${elapsedSec}s`,
            'color:#0ea5e9;font-weight:700;',
            'color:#94a3b8;',
         );
      }, 15000);
   };

   socket.on('connect', () => {
      console.log('Connecté au serveur via WebSocket');
      statusManager.log(`Connexion WebSocket établie (transport=${transportName()}).`);
      lastHeartbeatAt = Date.now();
      startClientHeartbeat();

      if (hasConnectedOnce) statusManager.log('Connexion rétablie.');
      hasConnectedOnce = true;
   });

   socket.on('disconnect', (reason) => {
      stopClientHeartbeat();
      renderQueue(0, null);
      statusManager.log(`Connexion perdue : ${reason}`, 'error');
      // Le serveur répond à l'ancienne session : un traitement en cours ne reviendra pas,
      // même si l'événement « thinking » n'était pas encore arrivé.
      if (isThinking || statusManager.isBusy()) {
         isThinking = false;
         autoHarmonizePending = false;
         statusManager.fail(
            'Connexion au serveur perdue pendant le calcul. Rechargez l’image pour relancer le traitement.',
         );
      }
   });

   socket.io.on('reconnect_attempt', (attempt) => {
      statusManager.log(`Reconnexion en cours (tentative ${attempt})…`);
   });

   socket.io.on('reconnect', (attempt) => {
      statusManager.log(`Reconnexion réussie après ${attempt} tentative(s).`);
   });

   socket.io.on('reconnect_error', (error) => {
      statusManager.log(`Échec de reconnexion : ${error?.message || error}`, 'error');
   });

   socket.io.on('error', (error) => {
      statusManager.log(`Erreur transport Socket.IO : ${error?.message || error}`, 'error');
   });

   socket.on('server_response', (msg) => {
      if (msg.error) {
         console.error('Erreur reçue du serveur :', msg.error);
         if (msg.reset === true) {
            reset();
            showUploadError(msg.error);
         }
         statusManager.fail(msg.error);
      } else {
         console.log('Message du serveur :', msg.data);
         statusManager.log(msg.data);
      }
   });

   socket.on('thinking', (data) => {
      isThinking = Boolean(data?.thinking);
      lastHeartbeatAt = Date.now();

      if (!isThinking && autoHarmonizePending) {
         autoHarmonizePending = false;
         requestHarmonization();
      }
   });

   // Toutes les couches sont prêtes : l'image peut être recolorée
   const onAllLayersReady = (palette) => {
      $('download-layers').classList.remove('hidden');
      showResultPane();
      layerManager.updateSumLayer(palette);
      threeSceneManager.updatePointCloud();
      $('stage-hint').classList.remove('hidden');
      statusManager.complete('layers');
      $('harmonies-section').classList.remove('hidden');

      // L'harmonisation part dès que le serveur a terminé le traitement. Le décodage
      // étant asynchrone, le serveur peut avoir déjà fini à ce moment-là.
      if (isThinking) autoHarmonizePending = true;
      else requestHarmonization();
   };

   // Position dans la file d'attente du serveur (0 quand le calcul démarre)
   socket.on('queue', (data) => {
      const position = Number(data?.position) || 0;
      statusManager.setQueuePosition(position);
      renderQueue(position, data?.eta ?? null);
      if (position > 0) statusManager.log(`En file d'attente, position ${position}.`);
   });

   socket.on('server_log', (msg) => {
      if (msg.error) {
         statusManager.log(msg.error, 'error');
      } else {
         lastHeartbeatAt = Date.now();
         statusManager.log(msg.data);
      }
   });

   socket.on('convex_hull', (data) => {
      statusManager.log(
         `Enveloppe convexe ${data.type === 'initial' ? 'complète' : 'simplifiée'} reçue (${data.vertices.length} sommets).`,
      );
      threeSceneManager.createConvexHullCircles(data.vertices, data.faces, data.type);

      // On extrait la palette reçue et on crée les éléments HTML
      paletteManager.create(data.type, data.vertices);

      // La palette simplifiée termine la première étape
      if (data.type === 'simplified') {
         $('download-palettes').classList.remove('hidden');
         statusManager.complete('palette');
      }
   });

   socket.on('layer_weights', (data) => {
      // data.width, data.height, data.id, data.encoding, data.weights (binaire compressé)
      const generation = layerGeneration;
      layerQueue = layerQueue
         .then(async () => {
            const weights = await decodeLayerWeights(data);
            if (generation !== layerGeneration) return; // une autre image a été chargée entre-temps

            const layer = { ...data, weights };
            const simplifiedPalette = paletteManager.getPalette();
            layerManager.updateLayer(layer, simplifiedPalette);
            threeSceneManager.addLayerWeights(weights, data.id);

            if (data.id === simplifiedPalette.length - 1) onAllLayersReady(simplifiedPalette);
         })
         .catch((error) => {
            console.error('Décodage de couche impossible :', error);
            if (generation === layerGeneration) {
               statusManager.fail('Les couches reçues sont illisibles. Rechargez l’image pour relancer le traitement.');
            }
         });
   });

   socket.on('harmonized', (data) => {
      const best = paletteManager.setHarmonies(data);
      const bestName = $(best)?.querySelector('.harmony-name')?.firstChild?.textContent.trim();
      statusManager.log(`Palettes harmonisées reçues. Meilleure note : ${bestName || best}.`);
      statusManager.complete('harmonies');
   });

   socket.on('error', (data) => {
      console.error('Erreur reçue du serveur :', data.message);
      statusManager.fail(data.message);
   });
}

/**
 * Décode les poids d'une couche envoyés par le serveur.
 * Format « uint8-deflate-base64 » : un octet par pixel (poids × 255),
 * compressé en zlib puis encodé en base64.
 * @param {{encoding: string, weights: string}} data
 * @returns {Promise<Float32Array>} Poids dans [0, 1].
 */
async function decodeLayerWeights(data) {
   if (data.encoding !== 'uint8-deflate-base64') throw new Error(`Format de couche inconnu : ${data.encoding}`);

   // Le navigateur décode le base64 nativement via une URL data:
   const response = await fetch(`data:application/octet-stream;base64,${data.weights}`);
   const stream = response.body.pipeThrough(new DecompressionStream('deflate'));
   const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
   const weights = new Float32Array(bytes.length);
   for (let i = 0; i < bytes.length; i++) weights[i] = bytes[i] / 255;
   return weights;
}

/**
 * Affiche la file d'attente : un pixel par image (en cours, en attente, la vôtre),
 * le nombre d'images avant la vôtre et une estimation du temps restant.
 * @param {number} position - Images à traiter avant la vôtre (0 = calcul démarré).
 * @param {number|null} eta - Attente estimée en secondes (null si inconnue).
 */
function renderQueue(position, eta) {
   const waiting = position > 0;
   $('queue-panel').classList.toggle('hidden', !waiting);
   $('stage').classList.toggle('is-waiting', waiting);
   if (!waiting) return;

   const pixels = $('queue-pixels');
   pixels.innerHTML = '';
   for (let i = 0; i <= position; i++) {
      const pixel = document.createElement('span');
      pixel.className = 'queue-pixel';
      if (i === 0) pixel.classList.add('is-running');
      if (i === position) pixel.classList.add('is-yours');
      pixels.appendChild(pixel);
   }

   $('queue-title').textContent = position === 1 ? '1 image avant la vôtre' : `${position} images avant la vôtre`;

   const etaText = eta == null ? '' : eta < 60 ? 'Moins d’une minute' : `Environ ${Math.ceil(eta / 60)} min`;
   $('queue-eta').textContent = etaText;
   $('queue-eta').classList.toggle('hidden', !etaText);
}

/**
 * Demande au serveur les palettes harmonisées à partir de la palette simplifiée d'origine.
 */
function requestHarmonization() {
   const simplifiedPalette = paletteManager.getOriginalSimplified();
   socket.emit('harmonize', { palette: simplifiedPalette });
   console.log("Demande d'harmonisation de la palette au serveur...");
   statusManager.log('Calcul des palettes harmonisées…');
}

/**
 * Revient à l'état « aucune image » : vide les panneaux et la scène 3D.
 */
function reset() {
   [
      'palette-section',
      'harmonies-section',
      'layers-section',
      'previews-container',
      'stage-hint',
      'download-palettes',
      'change-image',
   ].forEach((id) => $(id).classList.add('hidden'));
   $('drag-area').classList.remove('hidden');
   $('original-image').src = '';
   $('compare-image').src = '';
   $('result-pane').classList.add('hidden');
   $('stage').classList.remove('has-result');

   autoHarmonizePending = false;
   layerGeneration++;
   renderQueue(0, null);
   threeSceneManager.reset();
   paletteManager.reset();
   layerManager.reset();
}

/**
 * Affiche le résultat à côté du cube (le rendu 3D se redimensionne tout seul).
 */
function showResultPane() {
   $('stage').classList.add('has-result');
   $('result-pane').classList.remove('hidden');
}

/**
 * Bouton « Maintenir pour comparer » : l'originale recouvre le résultat
 * tant que le bouton est enfoncé (souris, toucher ou clavier).
 */
function initCompareButton() {
   const button = $('compare-original');
   const original = $('compare-image');
   const show = (visible) => {
      original.classList.toggle('hidden', !visible);
      button.setAttribute('aria-pressed', String(visible));
   };

   button.addEventListener('pointerdown', (e) => {
      button.setPointerCapture(e.pointerId);
      show(true);
   });
   ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((type) =>
      button.addEventListener(type, () => show(false)),
   );
   button.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
         e.preventDefault();
         show(true);
      }
   });
   button.addEventListener('keyup', () => show(false));
   button.addEventListener('blur', () => show(false));

   // On peut aussi maintenir l'image elle-même (geste principal sur mobile).
   // Au toucher, un court délai évite un clignotement quand le geste est en
   // fait un défilement : le navigateur l'annule alors (pointercancel).
   const frame = $('result-frame');
   let pressTimer = 0;
   frame.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => show(true), e.pointerType === 'touch' ? 150 : 0);
   });
   ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) =>
      frame.addEventListener(type, () => {
         clearTimeout(pressTimer);
         show(false);
      }),
   );
   frame.addEventListener('contextmenu', (e) => e.preventDefault());
}

/**
 * Sections repliables (palette, espace RGB, couches) : actives uniquement sur
 * petit écran, où le parcours tient en une colonne. Sur desktop, tout reste visible.
 */
function initCollapsibleSections() {
   const smallScreen = window.matchMedia('(max-width: 900px)');
   const toggles = document.querySelectorAll('.section-toggle');
   const sync = () => toggles.forEach((toggle) => (toggle.disabled = !smallScreen.matches));
   smallScreen.addEventListener('change', sync);
   sync();

   toggles.forEach((toggle) =>
      toggle.addEventListener('click', () => {
         const open = toggle.getAttribute('aria-expanded') !== 'true';
         toggle.setAttribute('aria-expanded', String(open));
         if (toggle.id === 'rgb-toggle') $('stage').classList.toggle('rgb-open', open);
         else toggle.closest('.collapsible').classList.toggle('is-open', open);
      }),
   );
}

/**
 * Affiche (ou efface) une erreur de sélection de fichier sous la zone de dépôt.
 * @param {string} [message]
 */
function showUploadError(message = '') {
   $('upload-error').textContent = message;
   $('upload-error').classList.toggle('hidden', !message);
}

/**
 * Gère l'upload d'une image par l'utilisateur.
 * @param {File} file - Fichier image à uploader.
 */
function onImageUpload(file) {
   const originalImage = $('original-image');
   showUploadError();

   if (!file) return;

   if (!ACCEPTED_TYPES.includes(file.type)) {
      showUploadError(
         'Ce fichier n’est pas pris en charge. Choisissez une image JPG, PNG ou WebP.',
      );
      return;
   }

   const reader = new FileReader();
   reader.onload = (event) => {
      if (event.target.result.length > MAX_IMAGE_DATA_LENGTH) {
         showUploadError('Cette image dépasse 5 Mo. Choisissez une image plus légère.');
         return;
      }

      const img = new Image();
      img.onload = () => {
         const pixels = img.naturalWidth * img.naturalHeight;
         if (pixels > MAX_IMAGE_PIXELS) {
            showUploadError(
               `Cette image fait ${img.naturalWidth}×${img.naturalHeight} pixels (${mpx(pixels, 1)} Mpx). ` +
                  `La limite est de ${mpx(MAX_IMAGE_PIXELS)} Mpx : réduisez-la avant de l’envoyer.`,
            );
            return;
         }

         // On repart de zéro seulement une fois la nouvelle image validée
         reset();
         $('drag-area').classList.add('hidden');
         $('change-image').classList.remove('hidden');
         $('previews-container').classList.remove('hidden');
         $('compare-image').src = event.target.result;

         originalImage.onload = () => {
            threeSceneManager.recreateFromOriginal();
         };
         originalImage.src = event.target.result;

         // On envoie l'image encodée en base64 au serveur via Socket.IO
         statusManager.begin();
         statusManager.log(
            `Envoi de l’image (${img.naturalWidth}×${img.naturalHeight}) au serveur…`,
         );
         socket.emit('upload_image', { image_data: event.target.result });
      };
      img.onerror = () =>
         showUploadError('Cette image n’a pas pu être lue. Essayez un autre fichier.');
      img.src = event.target.result;
   };
   reader.readAsDataURL(file);
}

/**
 * Initialise les fonctionnalités web (dépôt de fichier, sélection, raccourcis).
 */
function initWebFeatures() {
   const input = $('upload');
   const area = $('drag-area');
   const openPicker = () => input.click();

   area.addEventListener('click', openPicker);
   area.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
         e.preventDefault();
         openPicker();
      }
   });
   $('change-image').addEventListener('click', openPicker);
   initCompareButton();
   initCollapsibleSections();

   input.addEventListener('change', (e) => {
      onImageUpload(e.target.files[0]);
      input.value = ''; // permet de choisir à nouveau le même fichier
   });

   // L'image peut être déposée n'importe où sur la page
   let dragDepth = 0;
   document.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragDepth++;
      area.classList.add('dragover');
   });
   document.addEventListener('dragover', (e) => e.preventDefault());
   document.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) area.classList.remove('dragover');
   });
   document.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0;
      area.classList.remove('dragover');
      onImageUpload(e.dataTransfer.files[0]);
   });
}
