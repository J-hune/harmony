import * as THREE from "three";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry";
import {LineMaterial} from "three/examples/jsm/lines/LineMaterial";
import { Line2 } from "three/examples/jsm/lines/Line2";
import Stats from "stats"

let scene, camera, renderer, controls, pointCloud, stats;
init3D();
animate();

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
                const img = new Image();
                img.onload = () => createPointCloud(img);
                img.src = event.target.result;

                // On envoie l'image au serveur
                const formData = new FormData();
                formData.append("image", file);
                fetch("/api/upload", {
                    method: "POST",
                    body: formData,
                }).then((response) => {
                    if (response.ok) {
                        console.log("Image envoyée au serveur");
                    } else {
                        console.error("Erreur lors de l'envoi de l'image");
                    }
                });
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

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

controls.enableDamping = true;
function animate() {
    requestAnimationFrame(animate);
    if (controls.dampingFactor > 0) controls.update();
    renderer.render(scene, camera);
    stats.update();
}
