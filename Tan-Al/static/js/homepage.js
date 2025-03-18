import * as THREE from "three";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls.js";
import {colorArray} from "./colors.js";

let camera, scene, renderer, controls, points;

function init() {
    const container = document.getElementById("webgl-output");

    // Création de la scène
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    // Création de la caméra
    camera = new THREE.PerspectiveCamera(5, container.clientWidth / container.clientHeight, 5, 10000);
    camera.position.set(0, -2500, 0);
    camera.up.set(0, 0, 1);

    // Création du renderer
    renderer = new THREE.WebGLRenderer({antialias: true});
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    // Création des contrôles
    controls = new OrbitControls(camera, renderer.domElement);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.05;

    // Création des particules
    const particlesGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(colorArray.length * 3);
    const colors = new Float32Array(colorArray.length * 3);

    for (let i = 0; i < colorArray.length; i++) {
        const [r, g, b] = colorArray[i];

        // Calcul de la position
        positions[i * 3] = -(r - 255);
        positions[i * 3 + 1] = -(g - 255);
        positions[i * 3 + 2] = -(b - 255);

        // Conversion de la couleur et passage en linéaire
        const color = new THREE.Color(r / 255, g / 255, b / 255);
        color.convertSRGBToLinear();

        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }

    particlesGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3)
    );
    particlesGeometry.setAttribute(
        "color",
        new THREE.BufferAttribute(colors, 3)
    );

    const material = new THREE.PointsMaterial({
        size: 2,
        vertexColors: true,
    });
    points = new THREE.Points(particlesGeometry, material);
    scene.add(points);
    points.translateZ(20);

    // Gestion du redimensionnement
    window.addEventListener("resize", onWindowResize);

    const button = document.getElementById("start");
    button.addEventListener("click", () => {
        window.location.href = "/app";
    });
}

function onWindowResize() {
    const container = document.getElementById("webgl-output");

    const width = container.clientWidth;
    const height = container.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

init();
animate();