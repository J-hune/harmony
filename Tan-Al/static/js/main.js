import * as THREE from "three";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls";
import {LineGeometry} from "three/examples/jsm/lines/LineGeometry";
import {LineMaterial} from "three/examples/jsm/lines/LineMaterial";
import {Line2} from "three/examples/jsm/lines/Line2";
import Stats from "stats";
import {io} from "socket.io";

let scene, camera, renderer, controls, pointCloud;
let overlayMesh = {}

let stats, socket;

init3D();
initSocket();
animate();

function initSocket() {
    socket = io();

    socket.on('connect', () => {
        console.log('Connecté au serveur via WebSocket');
    });

    socket.on('server_response', (msg) => {
        console.log('Message du serveur :', msg.data);
    });

    socket.on('convex_hull', (data) => {
        console.log('Chargement des sommets de l\'enveloppe convexe...');
        createConvexHullCircles(data.vertices, data.faces);
        console.log(data.faces);
    });

    socket.on('error', (data) => {
        console.error('Erreur reçue du serveur :', data.message);
    });
}

function init3D() {
    // Initialisation de la scène, caméra et renderer
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(1, 1, 1);

    renderer = new THREE.WebGLRenderer({antialias: true});
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    document.body.appendChild(renderer.domElement);

    // Contrôles orbitaux
    controls = new OrbitControls(camera, renderer.domElement);

    // On initialise stats.js et on l'ajoute au body
    stats = new Stats();
    stats.dom.style.position = "absolute";
    stats.dom.style.top = "0";
    stats.dom.style.right = "0";
    stats.dom.style.left = "auto";
    document.body.appendChild(stats.dom);

    // On ajoute un listener pour redimensionner la fenêtre
    window.addEventListener("resize", onWindowResize, false);

    // On ajoute un listener pour charger une image
    document.getElementById("upload").addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                // Envoi de l'image encodée en base64 via Socket.IO
                socket.emit('upload_image', {image_data: event.target.result});

                const img = new Image();
                img.onload = () => createPointCloud(img);
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    });

    // Ajout du cube représentant l'espace RGB
    buildRgbCube();
}

function createAxisLine(position0, position1, color0, color1) {
    // Création de la géométrie
    const geometry = new LineGeometry();

    // Positions des points
    const positions = new Float32Array(6); // 2 points = 6 valeurs (x, y, z)
    positions.set([position0.x, position0.y, position0.z, position1.x, position1.y, position1.z]);
    geometry.setPositions(positions);

    // Matériau de la ligne
    const material = new LineMaterial({
        linewidth: 0.004, // Ligne épaisse
        color: 0xfffffff, // Couleur de la ligne
        vertexColors: true,
    });

    // Définition des couleurs des points
    const colors = new Float32Array([color0.r, color0.g, color0.b, color1.r, color1.g, color1.b]);
    geometry.setColors(colors);

    // Création de la ligne en utilisant Line2
    const line = new Line2(geometry, material);
    line.computeLineDistances(); // Calcul des distances de ligne pour les rendus de courbes

    return line;
}

function buildRgbCube() {
    const axes = new THREE.Object3D();

    // Base du cube
    axes.add(createAxisLine(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, -0.5, -0.5), new THREE.Color(0, 0, 0), new THREE.Color(1, 0, 0)));
    axes.add(createAxisLine(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(-0.5, -0.5, 0.5), new THREE.Color(0, 0, 0), new THREE.Color(0, 1, 0)));
    axes.add(createAxisLine(new THREE.Vector3(-0.5, -0.5, 0.5), new THREE.Vector3(0.5, -0.5, 0.5), new THREE.Color(0, 1, 0), new THREE.Color(1, 1, 0)));
    axes.add(createAxisLine(new THREE.Vector3(0.5, -0.5, -0.5), new THREE.Vector3(0.5, -0.5, 0.5), new THREE.Color(1, 0, 0), new THREE.Color(1, 1, 0)));

    // Sommet du cube
    axes.add(createAxisLine(new THREE.Vector3(-0.5, 0.5, -0.5), new THREE.Vector3(0.5, 0.5, -0.5), new THREE.Color(0, 0, 1), new THREE.Color(1, 0, 1)));
    axes.add(createAxisLine(new THREE.Vector3(-0.5, 0.5, -0.5), new THREE.Vector3(-0.5, 0.5, 0.5), new THREE.Color(0, 0, 1), new THREE.Color(0, 1, 1)));
    axes.add(createAxisLine(new THREE.Vector3(-0.5, 0.5, 0.5), new THREE.Vector3(0.5, 0.5, 0.5), new THREE.Color(0, 1, 1), new THREE.Color(1, 1, 1)));
    axes.add(createAxisLine(new THREE.Vector3(0.5, 0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5), new THREE.Color(1, 0, 1), new THREE.Color(1, 1, 1)));

    // Arêtes du cube
    axes.add(createAxisLine(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(-0.5, 0.5, -0.5), new THREE.Color(0, 0, 0), new THREE.Color(0, 0, 1)));
    axes.add(createAxisLine(new THREE.Vector3(-0.5, -0.5, 0.5), new THREE.Vector3(-0.5, 0.5, 0.5), new THREE.Color(0, 1, 0), new THREE.Color(0, 1, 1)));
    axes.add(createAxisLine(new THREE.Vector3(0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, -0.5), new THREE.Color(1, 0, 0), new THREE.Color(1, 0, 1)));
    axes.add(createAxisLine(new THREE.Vector3(0.5, -0.5, 0.5), new THREE.Vector3(0.5, 0.5, 0.5), new THREE.Color(1, 1, 0), new THREE.Color(1, 1, 1)));

    scene.add(axes);
}

function createPointCloud(img) {
    if (pointCloud !== null) {
        scene.remove(pointCloud);
        scene.remove(overlayMesh.rims);
        scene.remove(overlayMesh.circle);
        overlayMesh = {};
    }

    // Création d'un canvas pour extraire les pixels
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
        // Extraction des composantes RGB normalisées
        const r = imageData[4 * i] / 255;
        const g = imageData[4 * i + 1] / 255;
        const b = imageData[4 * i + 2] / 255;


        // Position dans l'espace RGB. On soustrait 0.5 pour centrer le nuage dans [-0.5, 0.5]
        positions[3 * i] = r - 0.5;
        positions[3 * i + 1] = g - 0.5;
        positions[3 * i + 2] = b - 0.5;

        // Couleur identique aux valeurs d'origine
        const color = new THREE.Color(r, g, b);
        color.convertSRGBToLinear();
        colors[3 * i] = color.r;
        colors[3 * i + 1] = color.g;
        colors[3 * i + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({size: 0.01, vertexColors: true});
    pointCloud = new THREE.Points(geometry, material);
    scene.add(pointCloud);
}

function createConvexHullCircles(vertices, faces) {
    if (!vertices || vertices.length === 0) return;

    // Conteneurs pour les cercles, leurs contours et les arêtes
    overlayMesh.circle = new THREE.Object3D();
    overlayMesh.rims = new THREE.Object3D();
    overlayMesh.edges = new THREE.Object3D();

    const radius = 0.02; // Rayon du cercle
    const radiusRim = radius * 1.2; // Rayon du contour
    const segments = 32; // Précision du cercle

    // Géométrie et matériaux pour les cercles et les contours
    const circleGeometry = new THREE.SphereGeometry(radius, segments, segments);
    const circleRimGeometry = new THREE.CircleGeometry(radiusRim, segments);
    const circleRimMaterial = new THREE.MeshBasicMaterial({color: 0xFFFFFF});

    vertices.forEach(vertex => {
        // Définition de la couleur
        const color = new THREE.Color(vertex[0], vertex[1], vertex[2]).convertSRGBToLinear();
        const circleMaterial = new THREE.MeshBasicMaterial({color});

        // Création du cercle
        const circle = new THREE.Mesh(circleGeometry, circleMaterial);
        circle.position.set(vertex[0] - 0.5, vertex[1] - 0.5, vertex[2] - 0.5);
        overlayMesh.circle.add(circle);

        // Création du contour
        const rim = new THREE.Mesh(circleRimGeometry, circleRimMaterial);
        rim.position.set(vertex[0] - 0.5, vertex[1] - 0.5, vertex[2] - 0.5);
        overlayMesh.rims.add(rim);
    });

    // Création des arêtes à partir des faces
    const edgeMaterial = new LineMaterial({
        linewidth: 0.003, // Ligne épaisse
        color: 0xfffffff, // Couleur de la ligne
        vertexColors: true,
    });


    faces.forEach(face => {
        const vertex1 = new THREE.Vector3(face[0][0] - 0.5, face[0][1] - 0.5, face[0][2] - 0.5);
        const vertex2 = new THREE.Vector3(face[1][0] - 0.5, face[1][1] - 0.5, face[1][2] - 0.5);
        const vertex3 = new THREE.Vector3(face[2][0] - 0.5, face[2][1] - 0.5, face[2][2] - 0.5);

        // Ajouter des arêtes (lignes entre les vertices)
        addEdgeToScene(vertex1, vertex2);
        addEdgeToScene(vertex2, vertex3);
        addEdgeToScene(vertex3, vertex1);
    });

    // Fonction pour ajouter une arête
    function addEdgeToScene(v1, v2) {
        const points = [v1, v2];
        const geometry = new LineGeometry();
        geometry.setPositions(points.map(p => [p.x, p.y, p.z]).flat());
        geometry.setColors([1, 1, 1, 1, 1, 1]);
        const line = new Line2(geometry, edgeMaterial);
        overlayMesh.edges.add(line);
    }

    // Ajouter les groupes à la scène
    scene.add(overlayMesh.circle);
    scene.add(overlayMesh.rims);
    scene.add(overlayMesh.edges);
}


function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    // Si les cercles de l'enveloppe convexe sont présents, on les fait toujours regarder vers la caméra
    if (overlayMesh.rims) overlayMesh.rims.children.forEach(rim => {
        rim.lookAt(camera.position);
    });

    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    stats.update();
}
