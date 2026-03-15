import {io} from "socket.io";

import {LayerManager} from './layers.js';
import {PaletteManager} from './palettes.js';
import {ThreeSceneManager} from './three.js';
import {TerminalManager} from './terminal.js';
import {TooltipsManager} from './tooltips.js';

// Variables globales
let socket;
const tooltipsManager = new TooltipsManager();
const paletteManager = new PaletteManager();
const layerManager = new LayerManager();
const threeSceneManager = new ThreeSceneManager(paletteManager, layerManager);
const terminalManager = new TerminalManager(threeSceneManager);

// Initialisation des managers et de la connexion Socket.IO
threeSceneManager.init();
initWebFeatures();
tooltipsManager.init();

// On initialise la connexion Socket.IO
await fetch('/get_socket_id')
    .then(response => response.json())
    .then(data => {
        let windowName = window.location.href.split('/')[2];
        if (windowName.includes(':')) {
            windowName = windowName.split(':')[0];
        }

        if (data.socket_id) {
            socket = io.connect(windowName, {path: '/' + data.socket_id + '/socket.io/'});
            initSocket();
        } else {
            socket = io.connect('http://' + windowName + ':' + data.socket_port, { path: '/socket.io/' });
            initSocket();
        }
    })
    .catch(error => console.error('Erreur lors de la récupération du port WebSocket:', error));

/**
 * Initialise la connexion Socket.IO et définit les gestionnaires d'événements.
 */
function initSocket() {
    let hasConnectedOnce = false;
    let isThinking = false;
    let lastHeartbeatAt = Date.now();
    let heartbeatTimer = null;

    const nowTag = () => new Date().toLocaleTimeString('fr-FR', {hour12: false});
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
            console.info(`%c[${nowTag()}] heartbeat client%c ${phase} | transport=${transportName()} | +${elapsedSec}s`,
                'color:#0ea5e9;font-weight:700;',
                'color:#94a3b8;');
        }, 15000);
    };

    socket.on('connect', () => {
        console.log('Connecté au serveur via WebSocket');
        terminalManager.logMessage(`[${nowTag()}] Connexion WebSocket etablie (transport=${transportName()})`, 'important');
        lastHeartbeatAt = Date.now();
        startClientHeartbeat();

        if (hasConnectedOnce) {
            terminalManager.logMessage(`[${nowTag()}] Connexion retablie. Le traitement serveur continue si la tache est encore active.`, 'important');
        }

        hasConnectedOnce = true;
    });

    socket.on('disconnect', (reason) => {
        stopClientHeartbeat();
        terminalManager.logMessage(`[${nowTag()}] Connexion perdue: ${reason}`, 'important');
    });

    socket.io.on('reconnect_attempt', (attempt) => {
        terminalManager.logMessage(`[${nowTag()}] Reconnexion en cours (tentative #${attempt})...`, 'important');
    });

    socket.io.on('reconnect', (attempt) => {
        terminalManager.logMessage(`[${nowTag()}] Reconnexion reussie apres ${attempt} tentative(s).`, 'important');
    });

    socket.io.on('reconnect_error', (error) => {
        terminalManager.logMessage(`[${nowTag()}] Echec de reconnexion: ${error?.message || error}`, 'error');
    });

    socket.io.on('error', (error) => {
        terminalManager.logMessage(`[${nowTag()}] Erreur transport Socket.IO: ${error?.message || error}`, 'error');
    });

    socket.on('server_response', (msg) => {
        if (msg.error) {
            console.error('Erreur reçue du serveur :', msg.error);
            terminalManager.logMessage('Erreur reçue du serveur : ' + msg.error, 'error');
            if (msg.reset === true) reset();
        } else {
            console.log('Message du serveur :', msg.data);
        }
    });

    socket.on('thinking', (data) => {
        isThinking = Boolean(data?.thinking);
        lastHeartbeatAt = Date.now();
        if (isThinking) terminalManager.startThinking();
        else terminalManager.stopThinking();
    });

    socket.on('server_log', (msg) => {
        if (msg.error) {
            terminalManager.logMessage('Erreur reçue du serveur : ' + msg.error, 'error');
        } else {
            lastHeartbeatAt = Date.now();
            terminalManager.logMessage(`[${nowTag()}] ${msg.data}`);
        }
    });

    socket.on('convex_hull', (data) => {
        terminalManager.logMessage(`Chargement des sommets de l'enveloppe convexe contenant ${data.vertices.length} sommets...`);
        threeSceneManager.createConvexHullCircles(data.vertices, data.faces, data.type);

        // On extrait la palette reçue et on crée les éléments HTML
        paletteManager.create(data.type, data.vertices);

        // Si on a reçu l'enveloppe convexe simplifiée, on affiche le bouton de téléchargement
        if (data.type === 'simplified') {
            document.getElementById('download-palettes').classList.remove('hidden');
        }
    });

    socket.on('layer_weights', (data) => {
        // data.width, data.height, data.id, data.weights (rgba array)
        const simplifiedPalette = paletteManager.getPalette();
        layerManager.updateLayer(data, simplifiedPalette);
        threeSceneManager.addLayerWeights(data.weights, data.id);

        // Si on a reçu toutes les couches, on affiche le bouton de téléchargement
        if (data.id === simplifiedPalette.length - 1) {
            document.getElementById('download-layers').classList.remove('hidden');
            layerManager.updateSumLayer(simplifiedPalette);
            threeSceneManager.updatePointCloud();

            // On avertit l'utilisateur qu'il peut modifier les couleurs de la palette
            terminalManager.logMessage("💡 Information, vous pouvez modifier les couleurs de la palette en déplaçant les points de l'enveloppe convexe.", 'important');

            // On réactive le bouton d'harmonisation
            document.getElementById('harmonize').disabled = false;
        }
    });

    socket.on('harmonized', (data) => {
        // On réactive tous les boutons d'harmonie, on prévient l'utilisateur et on stocke les harmonies
        document.querySelectorAll('.harmony-button').forEach(button => button.disabled = false);

        // On trouve la palette harmonisée avec la meilleure note (attention data est un dictionnaire)
        const bestPalette = Object.keys(data).reduce((best, key) => {
            if (data[key].rate > data[best].rate) {
                return key;
            }
            return best;
        });

        const names = {
            "triadic-harmony": "Harmonie triadique",
            "complementary-harmony": "Harmonie complémentaire",
            "square-harmony": "Harmonie en carré",
            "split-harmony": "Harmonie divisée",
            "double-split-harmony": "Harmonie doublement divisée",
            "analogous-harmony": "Harmonie analogue",
            "monochromatic-harmony": "Harmonie monochromatique"
        }

        const randomId = Math.floor(Math.random() * 1000000);
        terminalManager.logMessage("Les palettes harmonisées ont été générées, celle qui a la meilleure note est celle " +
            "qui suit l'<button id='" + randomId + "' class='terminal-button'>👑 " + names[bestPalette] + "</button>", 'important');

        // On ajoute un listener
        const button = document.getElementById(randomId);
        threeSceneManager.addHarmonyButtonListener(button, bestPalette);
        paletteManager.setHarmonies(data);
    });

    socket.on('error', (data) => {
        console.error('Erreur reçue du serveur :', data.message);
    });
}

/**
 * Réinitialise l'affichage des prévisualisations et enlève les éléments 3D précédents.
 */
function reset() {
    // On vide les conteneurs HTML
    const idsToEmpty = ["initial-palette", "selected-palette", "layers-container"];
    const doNotRemoveLast = ["layers-container"];
    idsToEmpty.forEach(id => {
        const container = document.getElementById(id);
        if (container && !doNotRemoveLast.includes(id)) container.innerHTML = '';
        else if (container && doNotRemoveLast.includes(id)) {
            while (container.childElementCount > 1) {
                container.removeChild(container.firstElementChild);
            }
        }
    });

    // On cache les éléments HTML
    const idsToHide = [
        "previews-title", "previews-container", "original-image", "harmonized-image",
        "palettes-title", "initial-palette", "selected-palette", "download-palettes",
        "layers-title", "layers-container", "download-layers", "rollback-palette"
    ];
    idsToHide.forEach(id => {
        const element = document.getElementById(id);
        if (element && !element.classList.contains('hidden')) element.classList.add('hidden');
    });

    // On réinitialise l'image originale
    const originalImage = document.getElementById('original-image');
    originalImage.src = '';

    // On désactive les boutons d'harmonie
    document.querySelectorAll('.harmony-button').forEach(button => button.disabled = true);
    document.getElementById('harmonize').disabled = true;

    terminalManager.stopThinking();
    threeSceneManager.reset();
    paletteManager.reset();
    layerManager.reset();
}

/**
 * Gère l'upload d'une image par l'utilisateur.
 * @param {File} file - Fichier image à uploader.
 */
function onImageUpload(file) {
    const originalImage = document.getElementById('original-image');

    if (!file) {
        console.error('Aucun fichier sélectionné');
        return;
    }

    // On réinitialise le contexte 3D et les prévisualisations
    reset();

    // On vérifie que le fichier est bien une image (au cas où ?)
    if (!file.type.startsWith('image/')) {
        console.error('Le fichier n\'est pas une image');
        terminalManager.logMessage('Le fichier n\'est pas une image', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        // On vérifie que la taille de l'image est inférieure à 5 Mo
        if (event.target.result.length > 5 * 1024 * 1024) {
            console.error('L\'image est trop grande (5 Mo max)');
            terminalManager.logMessage('L\'image est trop grande (5 Mo max)', 'error');
            return;
        }

        const img = new Image();
        img.onload = () => {
            // On affiche le titre et le conteneur de prévisualisation
            originalImage.classList.remove('hidden');
            document.getElementById("previews-title").classList.remove('hidden');
            document.getElementById("previews-container").classList.remove('hidden');

            originalImage.src = event.target.result;

            // On envoie l'image encodée en base64 au serveur via Socket.IO
            socket.emit('upload_image', {image_data: event.target.result});
            console.log("Envoi de l'image au serveur, en attente de l'enveloppe convexe...");
            terminalManager.logMessage("Envoi de l'image au serveur, en attente de l'enveloppe convexe...");

            originalImage.onload = () => {
                threeSceneManager.recreateFromOriginal();
            }
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

/**
 * Initialise les fonctionnalités web (drag & drop, input file).
 */
function initWebFeatures() {
    terminalManager.logMessage("👋 Bienvenue sur IlFautQueJeTrouveUnNom !", 'important');

    // J'ai l'impression que le navigateur garde en cache les 'disabled' des boutons (dans le doute)
    document.querySelectorAll('.harmony-button').forEach(button => button.disabled = true);
    document.getElementById('harmonize').disabled = true;

    const input = document.getElementById('upload');
    const area = document.getElementById('drag-area');
    const harmonizeButton = document.getElementById('harmonize');

    /* ---------- Événements de la zone de drag & drop et de l'input ---------- */
    area.addEventListener('click', () => input.click());

    area.addEventListener('dragover', (e) => {
        e.preventDefault();
        area.classList.add('dragover');
    });

    area.addEventListener('dragleave', () => {
        area.classList.remove('dragover');
    });

    area.addEventListener('drop', (e) => {
        e.preventDefault();
        area.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        onImageUpload(file);
    });

    input.addEventListener('change', (e) => {
        e.preventDefault()
        const file = e.target.files[0];
        onImageUpload(file);
    });

    document.getElementById("previews-container").addEventListener('click', (e) => {
        // Si on clique sur une image, on propose de la télécharger (en full size)
        if (e.target.tagName === 'IMG') {
            const a = document.createElement('a');
            a.href = e.target.src;
            a.download = new Date().toISOString() + '.png';
            a.click();

            e.preventDefault(); // On empêche le navigateur de suivre le lien
            a.remove(); // On supprime le lien après le téléchargement
        }
    });

    harmonizeButton.addEventListener('click', () => {
        const simplifiedPalette = paletteManager.getOriginalSimplified();
        socket.emit('harmonize', {palette: simplifiedPalette});
        console.log("Demande d'harmonisation de la palette au serveur...");
        terminalManager.logMessage("Demande d'harmonisation de la palette au serveur...");
    });
}