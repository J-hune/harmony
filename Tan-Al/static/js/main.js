import * as THREE from "three";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls";
import {LineGeometry} from "three/examples/jsm/lines/LineGeometry";
import {LineMaterial} from "three/examples/jsm/lines/LineMaterial";
import {Line2} from "three/examples/jsm/lines/Line2";
import Stats from "stats";
import {io} from "socket.io";

// Variables globales
let scene, camera, renderer, controls, pointCloud;
let overlayMesh = {};
let stats, socket;
let thinkingInterval = null;
let thinkingElement = null;

// Initialisations principales
init3D();
initWebFeatures();
initSocket();
animate();

/**
 * Affiche un message dans le terminal de l'application.
 * @param {string} message - Message à afficher.
 * @param {string} [type='info'] - Type de message ('info' ou 'error').
 */
function logMessage(message, type = 'info') {
    const terminal = document.getElementById('terminal');
    const p = document.createElement('p');
    p.textContent = message;
    if (type === 'error') p.style.color = 'red';

    // On cherche si un thinking-indicator est présent pour placer le message avant
    const thinkingIndicator = document.getElementById('thinking-indicator');
    if (thinkingIndicator) {
        terminal.insertBefore(p, thinkingIndicator);
    } else {
        terminal.appendChild(p);
    }
    terminal.scrollTop = terminal.scrollHeight;
}

/**
 * Démarre l'animation du spinner.
 */
function startThinking() {
    if (thinkingElement) return;
    thinkingElement = document.createElement('p');
    thinkingElement.id = 'thinking-indicator';
    thinkingElement.textContent = '‎';
    document.getElementById('terminal').appendChild(thinkingElement);
    let states = ["▹▹▹▹▹", "▸▹▹▹▹", "▹▸▹▹▹", "▹▹▸▹▹", "▹▹▹▸▹", "▹▹▹▹▸"]
    let index = 0;
    thinkingInterval = setInterval(() => {
        index = (index + 1) % states.length;
        thinkingElement.textContent = states[index];
    }, 120);
}

/**
 * Arrête l'animation du spinner
 */
function stopThinking() {
    if (thinkingInterval) {
        clearInterval(thinkingInterval);
        thinkingInterval = null;
    }
    if (thinkingElement) {
        thinkingElement.parentNode.removeChild(thinkingElement);
        thinkingElement = null;
    }
}

/**
 * Initialise la connexion Socket.IO et définit les gestionnaires d'événements.
 */
function initSocket() {
    socket = io();

    socket.on('connect', () => {
        console.log('Connecté au serveur via WebSocket');
        logMessage('Connecté au serveur via WebSocket');
    });

    socket.on('server_response', (msg) => {
        if (msg.error) {
            console.error('Erreur reçue du serveur :', msg.error);
            logMessage('Erreur reçue du serveur : ' + msg.error, 'error');
        } else {
            console.log('Message du serveur :', msg.data);
            logMessage('Message du serveur : ' + msg.data);
        }
    });

    socket.on('thinking', (data) => {
        if (data.thinking) startThinking();
        else stopThinking();
    });

    socket.on('server_log', (msg) => {
        console.log('Log du serveur :', msg.data);
        logMessage('Log du serveur : ' + msg.data);
    });

    socket.on('convex_hull', (data) => {
        console.log(`Chargement des sommets de l'enveloppe convexe contenant ${data.vertices.length} sommets...`);
        logMessage(`Chargement des sommets de l'enveloppe convexe contenant ${data.vertices.length} sommets...`);
        createConvexHullCircles(data.vertices, data.faces);
    });

    socket.on('intermediate_image', (data) => {
        console.log(`Image de type ${data.type} reçue du serveur`);
        logMessage(`Image de type ${data.type} reçue du serveur`);

        const imageUrl = 'data:image/png;base64,' + data.image_data;
        const img = new Image();
        img.src = imageUrl;

        const imageContainer = document.getElementById(`${data.type}-container`);
        imageContainer.appendChild(img);

        // Affiche le titre et le conteneur de prévisualisation
        document.getElementById(`${data.type}-title`).classList.remove('preview-hidden');
        document.getElementById(`${data.type}-container`).classList.remove('preview-hidden');
    });

    socket.on('error', (data) => {
        console.error('Erreur reçue du serveur :', data.message);
    });
}

/**
 * Réinitialise l'affichage des prévisualisations et enlève les éléments 3D précédents.
 */
function reset() {
    const ids = ["previews", "palettes", "layers"];
    ids.forEach(id => {
        const title = document.getElementById(`${id}-title`);
        const container = document.getElementById(`${id}-container`);
        if (container) container.innerHTML = '';
        if (title && !title.classList.contains('preview-hidden')) title.classList.add('preview-hidden');
        if (container && !container.classList.contains('preview-hidden')) container.classList.add('preview-hidden');
    });

    if (pointCloud) {
        scene.remove(pointCloud);
        if (overlayMesh.rims) scene.remove(overlayMesh.rims);
        if (overlayMesh.circle) scene.remove(overlayMesh.circle);
        if (overlayMesh.edges) scene.remove(overlayMesh.edges);
        overlayMesh = {};
    }
}

/**
 * Gère l'upload d'une image par l'utilisateur.
 * @param {File} file - Fichier image à uploader.
 */
function onImageUpload(file) {
    const previewContainer = document.getElementById('previews-container');

    if (!file) {
        console.error('Aucun fichier sélectionné');
        return;
    }

    // Réinitialise les affichages précédents
    reset();

    // Vérifie que le fichier est bien une image
    if (!file.type.startsWith('image/')) {
        console.error('Le fichier n\'est pas une image');
        logMessage('Le fichier n\'est pas une image', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            // Affiche le titre et le conteneur de prévisualisation
            const previewTitle = document.getElementById("previews-title");
            previewTitle.classList.remove('preview-hidden');
            previewContainer.classList.remove('preview-hidden');

            previewContainer.appendChild(img);

            // Envoie l'image encodée en base64 au serveur via Socket.IO
            socket.emit('upload_image', { image_data: event.target.result });
            console.log("Envoi de l'image au serveur, en attente de l'enveloppe convexe...");
            logMessage("Envoi de l'image au serveur, en attente de l'enveloppe convexe...");

            createPointCloud(img);
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

/**
 * Initialise les fonctionnalités web (drag & drop, input file, redimensionnement).
 */
function initWebFeatures() {
    const input = document.getElementById('upload');
    const area = document.getElementById('drag-area');

    document.body.addEventListener('click', (e) => {
        // Si on clique sur une image, on propose de la télécharger (en full size)
        if (e.target.tagName === 'IMG') {
            const a = document.createElement('a');
            a.href = e.target.src;
            a.download = new Date().toISOString() + '.png';
            a.click();

            // On empêche le navigateur de suivre le lien
            e.preventDefault();

            // On supprime le lien après le téléchargement
            a.remove();
        }
    });

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
        const file = e.target.files[0];
        onImageUpload(file);
    });

    window.addEventListener("resize", onWindowResize, false);
}

/**
 * Initialise la scène 3D, la caméra, le renderer, les contrôles et les stats.
 */
function init3D() {
    const container = document.getElementById('webgl-output');

    // Création de la scène
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x171a21);

    // Configuration de la caméra
    camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(1, 1, 1);

    // Configuration du renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    // Contrôles orbitaux
    controls = new OrbitControls(camera, renderer.domElement);

    // Initialisation de stats.js
    stats = new Stats();
    stats.dom.style.position = "absolute";
    stats.dom.style.top = "0";
    stats.dom.style.right = "0";
    stats.dom.style.left = "auto";
    document.body.appendChild(stats.dom);

    // Ajout du cube représentant l'espace RGB
    buildRgbCube();
}

/**
 * Crée une ligne avec un dégradé de couleur entre deux points.
 * @param {THREE.Vector3} position0 - Point de départ.
 * @param {THREE.Vector3} position1 - Point d'arrivée.
 * @param {THREE.Color} color0 - Couleur au point de départ.
 * @param {THREE.Color} color1 - Couleur au point d'arrivée.
 * @returns {Line2} La ligne créée.
 */
function createAxisLine(position0, position1, color0, color1) {
    const geometry = new LineGeometry();
    const positions = new Float32Array([
        position0.x, position0.y, position0.z,
        position1.x, position1.y, position1.z
    ]);
    geometry.setPositions(positions);

    const material = new LineMaterial({
        linewidth: 0.004,
        color: 0xffffff, // Correction de la couleur
        vertexColors: true,
    });

    const colors = new Float32Array([
        color0.r, color0.g, color0.b,
        color1.r, color1.g, color1.b
    ]);
    geometry.setColors(colors);

    const line = new Line2(geometry, material);
    line.computeLineDistances();

    return line;
}

/**
 * Construit un cube RGB avec lignes et arêtes.
 */
function buildRgbCube() {
    const axes = new THREE.Object3D();
    const offset = 0.5; // Décalage pour centrer le cube dans [-0.5, 0.5]

    // Axes et arêtes du cube
    axes.add(createAxisLine(new THREE.Vector3(-offset, -offset, -offset), new THREE.Vector3(offset, -offset, -offset), new THREE.Color(0, 0, 0), new THREE.Color(1, 0, 0)));
    axes.add(createAxisLine(new THREE.Vector3(-offset, -offset, -offset), new THREE.Vector3(-offset, offset, -offset), new THREE.Color(0, 0, 0), new THREE.Color(0, 1, 0)));
    axes.add(createAxisLine(new THREE.Vector3(-offset, offset, -offset), new THREE.Vector3(offset, offset, -offset), new THREE.Color(0, 1, 0), new THREE.Color(1, 1, 0)));
    axes.add(createAxisLine(new THREE.Vector3(offset, -offset, -offset), new THREE.Vector3(offset, offset, -offset), new THREE.Color(1, 0, 0), new THREE.Color(1, 1, 0)));

    axes.add(createAxisLine(new THREE.Vector3(-offset, -offset, offset), new THREE.Vector3(offset, -offset, offset), new THREE.Color(0, 0, 1), new THREE.Color(1, 0, 1)));
    axes.add(createAxisLine(new THREE.Vector3(-offset, -offset, offset), new THREE.Vector3(-offset, offset, offset), new THREE.Color(0, 0, 1), new THREE.Color(0, 1, 1)));
    axes.add(createAxisLine(new THREE.Vector3(-offset, offset, offset), new THREE.Vector3(offset, offset, offset), new THREE.Color(0, 1, 1), new THREE.Color(1, 1, 1)));
    axes.add(createAxisLine(new THREE.Vector3(offset, -offset, offset), new THREE.Vector3(offset, offset, offset), new THREE.Color(1, 0, 1), new THREE.Color(1, 1, 1)));

    axes.add(createAxisLine(new THREE.Vector3(-offset, -offset, -offset), new THREE.Vector3(-offset, -offset, offset), new THREE.Color(0, 0, 0), new THREE.Color(0, 0, 1)));
    axes.add(createAxisLine(new THREE.Vector3(-offset, offset, -offset), new THREE.Vector3(-offset, offset, offset), new THREE.Color(0, 1, 0), new THREE.Color(0, 1, 1)));
    axes.add(createAxisLine(new THREE.Vector3(offset, -offset, -offset), new THREE.Vector3(offset, -offset, offset), new THREE.Color(1, 0, 0), new THREE.Color(1, 0, 1)));
    axes.add(createAxisLine(new THREE.Vector3(offset, offset, -offset), new THREE.Vector3(offset, offset, offset), new THREE.Color(1, 1, 0), new THREE.Color(1, 1, 1)));

    scene.add(axes);
}

/**
 * Crée un nuage de points 3D à partir d'une image.
 * @param {HTMLImageElement} img - Image source.
 */
function createPointCloud(img) {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const numPixels = canvas.width * canvas.height;
    const positions = new Float32Array(numPixels * 3);
    const colors = new Float32Array(numPixels * 3);

    for (let i = 0; i < numPixels; i++) {
        const r = imageData[4 * i] / 255;
        const g = imageData[4 * i + 1] / 255;
        const b = imageData[4 * i + 2] / 255;

        // Positionnement dans l'espace RGB centré
        positions[3 * i] = r - 0.5;
        positions[3 * i + 1] = g - 0.5;
        positions[3 * i + 2] = b - 0.5;

        const color = new THREE.Color(r, g, b);
        color.convertSRGBToLinear();
        colors[3 * i] = color.r;
        colors[3 * i + 1] = color.g;
        colors[3 * i + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({ size: 0.01, vertexColors: true });
    pointCloud = new THREE.Points(geometry, material);
    scene.add(pointCloud);
}

/**
 * Crée les éléments 3D (cercles, contours et arêtes) pour représenter l'enveloppe convexe.
 * @param {Array} vertices - Liste des sommets.
 * @param {Array} faces - Liste des faces (indices des sommets).
 */
function createConvexHullCircles(vertices, faces) {
    if (!vertices || vertices.length === 0) return;

    // Suppression des éléments existants
    if (overlayMesh.circle) scene.remove(overlayMesh.circle);
    if (overlayMesh.rims) scene.remove(overlayMesh.rims);
    if (overlayMesh.edges) scene.remove(overlayMesh.edges);

    overlayMesh.circle = new THREE.Object3D();
    overlayMesh.rims = new THREE.Object3D();
    overlayMesh.edges = new THREE.Object3D();

    const radius = 0.02;
    const radiusRim = radius * 1.2;
    const segments = 32;

    // Géométries et matériaux pour les cercles et contours
    const circleGeometry = new THREE.SphereGeometry(radius, segments, segments);
    const circleRimGeometry = new THREE.CircleGeometry(radiusRim, segments);
    const circleRimMaterial = new THREE.MeshBasicMaterial({ color: 0xFFFFFF });

    vertices.forEach(vertex => {
        // Création du cercle pour chaque sommet
        const color = new THREE.Color(vertex[0], vertex[1], vertex[2]).convertSRGBToLinear();
        const circleMaterial = new THREE.MeshBasicMaterial({ color });

        const circle = new THREE.Mesh(circleGeometry, circleMaterial);
        circle.position.set(vertex[0] - 0.5, vertex[1] - 0.5, vertex[2] - 0.5);
        overlayMesh.circle.add(circle);

        // Création du contour du cercle
        const rim = new THREE.Mesh(circleRimGeometry, circleRimMaterial);
        rim.position.set(vertex[0] - 0.5, vertex[1] - 0.5, vertex[2] - 0.5);
        overlayMesh.rims.add(rim);
    });

    // Matériau pour les arêtes
    const edgeMaterial = new LineMaterial({
        linewidth: 0.003,
        color: 0xffffff,
        vertexColors: true,
    });

    // Fonction pour ajouter une arête entre deux points
    function addEdgeToScene(v1, v2) {
        const points = [v1, v2];
        const geometry = new LineGeometry();
        geometry.setPositions(points.map(p => [p.x, p.y, p.z]).flat());
        geometry.setColors([1, 1, 1, 1, 1, 1]);
        const line = new Line2(geometry, edgeMaterial);
        overlayMesh.edges.add(line);
    }

    // Création des arêtes à partir des faces
    faces.forEach(face => {
        for (let i = 0; i < face.length; i++) {
            const currentIndex = face[i];
            const nextIndex = face[(i + 1) % face.length];
            const v1 = new THREE.Vector3(vertices[currentIndex][0] - 0.5, vertices[currentIndex][1] - 0.5, vertices[currentIndex][2] - 0.5);
            const v2 = new THREE.Vector3(vertices[nextIndex][0] - 0.5, vertices[nextIndex][1] - 0.5, vertices[nextIndex][2] - 0.5);
            addEdgeToScene(v1, v2);
        }
    });

    // Ajout des groupes à la scène
    scene.add(overlayMesh.circle);
    scene.add(overlayMesh.rims);
    scene.add(overlayMesh.edges);
}

/**
 * Met à jour la caméra et le renderer lors du redimensionnement de la fenêtre.
 */
function onWindowResize() {
    const container = document.getElementById('webgl-output');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

/**
 * Boucle d'animation principale.
 */
function animate() {
    // Faire en sorte que les contours des cercles regardent toujours vers la caméra
    if (overlayMesh.rims) {
        overlayMesh.rims.children.forEach(rim => rim.lookAt(camera.position));
    }

    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    stats.update();
}
