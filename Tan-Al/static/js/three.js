import * as THREE from "three";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls.js";
import {LineGeometry} from "three/examples/jsm/lines/LineGeometry.js";
import {LineMaterial} from "three/examples/jsm/lines/LineMaterial.js";
import {Line2} from "three/examples/jsm/lines/Line2.js";
import Stats from "stats";

// Décalage pour centrer les coordonnées RGB
const CENTER_OFFSET = 0.5;

class ThreeSceneManager {
    constructor(paletteManager, layerManager) {
        this.paletteManager = paletteManager;
        this.layerManager = layerManager;

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.stats = null;
        this.pointCloud = null;
        this.overlayMesh = {}; // Contiendra circle, rims et edges
        this.convexHulls = {};
        this.original = {};
        this.weights = [];
        this.paletteChanged = false;
        this.displayedPalette = "initial";
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.selectedPoint = null;

        this.initPaletteButtons();
    }

    // ========================
    // Fonctions utilitaires
    // ========================
    getNormalizedMouse(event) {
        const container = document.getElementById("webgl-output");
        return {
            x: (event.offsetX / container.offsetWidth) * 2 - 1,
            y: -(event.offsetY / container.offsetHeight) * 2 + 1,
        };
    }

    getCenteredVector(vertex) {
        return new THREE.Vector3(
            vertex[0] - CENTER_OFFSET,
            vertex[1] - CENTER_OFFSET,
            vertex[2] - CENTER_OFFSET
        );
    }

    clearOverlayMesh() {
        // Supprime tous les groupes d'overlay de la scène et réinitialise overlayMesh
        ["circle", "rims", "edges"].forEach((group) => {
            if (this.overlayMesh[group]) {
                this.scene.remove(this.overlayMesh[group]);
            }
        });
        this.overlayMesh = {};
    }

    removePointCloud() {
        if (this.pointCloud) {
            this.scene.remove(this.pointCloud);
            this.pointCloud.geometry.dispose();
            this.pointCloud.material.dispose();
            this.pointCloud = null;
        }
    }

    updateAllEdges() {
        if (!this.convexHulls.simplified) return;
        const {faces, vertices} = this.convexHulls.simplified;
        this.overlayMesh.edges.children.forEach((line, i) => {
            const faceIndex = Math.floor(i / 3); // Chaque face est un triangle
            const vertexIndex = i % 3;
            const face = faces[faceIndex];
            const v1 = this.getCenteredVector(vertices[face[vertexIndex]]);
            const v2 = this.getCenteredVector(vertices[face[(vertexIndex + 1) % face.length]]);
            line.geometry.setPositions([v1.x, v1.y, v1.z, v2.x, v2.y, v2.z]);
        });
    }

    // ========================
    // Gestion des boutons de palette
    // ========================
    initPaletteButtons() {
        document.getElementById("initial-palette").addEventListener("click", () => {
            if (this.paletteChanged) return;
            this.displayedPalette = "initial";
            if (this.convexHulls.initial) {
                this.createConvexHullCircles(
                    this.convexHulls.initial.vertices,
                    this.convexHulls.initial.faces,
                    "initial"
                );
            }
        });

        document.getElementById("selected-palette").addEventListener("click", () => {
            if (this.paletteChanged || !this.convexHulls.simplified) return;
            this.displayedPalette = "simplified";
            this.createConvexHullCircles(
                this.convexHulls.simplified.vertices,
                this.convexHulls.simplified.faces,
                "simplified"
            );
        });

        document.getElementById("rollback-palette").addEventListener("click", () => {
            this.rollback();
        });

        document.querySelectorAll(".harmony-button").forEach((button) => {
            this.addHarmonyButtonListener(button);
        });
    }

    // ========================
    // Initialisation de la scène et gestion globale
    // ========================
    init() {
        const container = document.getElementById("webgl-output");

        // On crée la scène
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x171a21);

        // On configure la caméra
        this.camera = new THREE.PerspectiveCamera(
            75,
            container.clientWidth / container.clientHeight,
            0.1,
            100
        );
        this.camera.position.set(1, 1, 1);

        // On configure le renderer
        this.renderer = new THREE.WebGLRenderer({antialias: true});
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        container.appendChild(this.renderer.domElement);

        // Contrôles orbitaux
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);

        // Initialisation de stats.js (fps)
        this.stats = new Stats();
        this.stats.dom.style.position = "absolute";
        this.stats.dom.style.top = "0";
        this.stats.dom.style.right = "0";
        this.stats.dom.style.left = "auto";
        this.stats.dom.style.opacity = 0.2;
        container.parentElement.appendChild(this.stats.dom);

        // Gestion des événements
        window.addEventListener("resize", this.onWindowResize.bind(this), false);
        this.renderer.domElement.addEventListener("mousedown", this.onMouseDown.bind(this), false);
        this.renderer.domElement.addEventListener("mousemove", this.onMouseMove.bind(this), false);
        this.renderer.domElement.addEventListener("mouseup", this.onMouseUp.bind(this), false);

        this.buildRgbCube(); // Ajout du cube RGB
        this.animate(); // Lancement de la boucle d'animation
    }

    reset() {
        // Réinitialisation du curseur des palettes et de l'état
        document.getElementById("initial-palette").style.cursor = "pointer";
        document.getElementById("selected-palette").style.cursor = "pointer";
        this.paletteChanged = false;
        this.displayedPalette = "initial";
        this.convexHulls = {};
        this.weights = [];

        this.removePointCloud();
        this.clearOverlayMesh();
    }

    addLayerWeights(weights, id) {
        this.weights[id] = weights;
    }

    updatePointCloud() {
        const palette = this.paletteManager.getPalette();
        if (palette.length !== this.weights.length) {
            console.error(
                "Le nombre de couches ne correspond pas au nombre de palettes: ",
                this.weights.length,
                palette.length
            );
            return;
        }

        const numPoints = this.weights[0].length;
        const positions = new Float32Array(numPoints * 3);
        const colors = new Float32Array(numPoints * 3);

        for (let i = 0; i < numPoints; i++) {
            let r = 0, g = 0, b = 0;
            for (let j = 0; j < this.weights.length; j++) {
                r += this.weights[j][i] * palette[j][0];
                g += this.weights[j][i] * palette[j][1];
                b += this.weights[j][i] * palette[j][2];
            }

            positions[3 * i] = r / 255 - CENTER_OFFSET;
            positions[3 * i + 1] = g / 255 - CENTER_OFFSET;
            positions[3 * i + 2] = b / 255 - CENTER_OFFSET;

            const color = new THREE.Color(r / 255, g / 255, b / 255);
            color.convertSRGBToLinear();
            colors[3 * i] = color.r;
            colors[3 * i + 1] = color.g;
            colors[3 * i + 2] = color.b;
        }

        this.pointCloud.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        this.pointCloud.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    }

    createAxisLine(position0, position1, color0, color1) {
        const geometry = new LineGeometry();
        const positions = new Float32Array([
            position0.x, position0.y, position0.z,
            position1.x, position1.y, position1.z,
        ]);
        geometry.setPositions(positions);

        const material = new LineMaterial({
            linewidth: 4,
            color: 0xffffff,
            vertexColors: true,
        });

        const colors = new Float32Array([
            color0.r, color0.g, color0.b,
            color1.r, color1.g, color1.b,
        ]);
        geometry.setColors(colors);

        const line = new Line2(geometry, material);
        line.computeLineDistances();

        return line;
    }

    buildRgbCube() {
        const axes = new THREE.Object3D();
        const offset = CENTER_OFFSET;

        // Création des axes et arêtes du cube
        axes.add(this.createAxisLine(new THREE.Vector3(-offset, -offset, -offset), new THREE.Vector3(offset, -offset, -offset), new THREE.Color(0, 0, 0), new THREE.Color(1, 0, 0)));
        axes.add(this.createAxisLine(new THREE.Vector3(-offset, -offset, -offset), new THREE.Vector3(-offset, offset, -offset), new THREE.Color(0, 0, 0), new THREE.Color(0, 1, 0)));
        axes.add(this.createAxisLine(new THREE.Vector3(-offset, offset, -offset), new THREE.Vector3(offset, offset, -offset), new THREE.Color(0, 1, 0), new THREE.Color(1, 1, 0)));
        axes.add(this.createAxisLine(new THREE.Vector3(offset, -offset, -offset), new THREE.Vector3(offset, offset, -offset), new THREE.Color(1, 0, 0), new THREE.Color(1, 1, 0)));

        axes.add(this.createAxisLine(new THREE.Vector3(-offset, -offset, offset), new THREE.Vector3(offset, -offset, offset), new THREE.Color(0, 0, 1), new THREE.Color(1, 0, 1)));
        axes.add(this.createAxisLine(new THREE.Vector3(-offset, -offset, offset), new THREE.Vector3(-offset, offset, offset), new THREE.Color(0, 0, 1), new THREE.Color(0, 1, 1)));
        axes.add(this.createAxisLine(new THREE.Vector3(-offset, offset, offset), new THREE.Vector3(offset, offset, offset), new THREE.Color(0, 1, 1), new THREE.Color(1, 1, 1)));
        axes.add(this.createAxisLine(new THREE.Vector3(offset, -offset, offset), new THREE.Vector3(offset, offset, offset), new THREE.Color(1, 0, 1), new THREE.Color(1, 1, 1)));

        axes.add(this.createAxisLine(new THREE.Vector3(-offset, -offset, -offset), new THREE.Vector3(-offset, -offset, offset), new THREE.Color(0, 0, 0), new THREE.Color(0, 0, 1)));
        axes.add(this.createAxisLine(new THREE.Vector3(-offset, offset, -offset), new THREE.Vector3(-offset, offset, offset), new THREE.Color(0, 1, 0), new THREE.Color(0, 1, 1)));
        axes.add(this.createAxisLine(new THREE.Vector3(offset, -offset, -offset), new THREE.Vector3(offset, -offset, offset), new THREE.Color(1, 0, 0), new THREE.Color(1, 0, 1)));
        axes.add(this.createAxisLine(new THREE.Vector3(offset, offset, -offset), new THREE.Vector3(offset, offset, offset), new THREE.Color(1, 1, 0), new THREE.Color(1, 1, 1)));

        this.scene.add(axes);
    }

    createPointCloud(img) {
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
            positions[3 * i] = r - CENTER_OFFSET;
            positions[3 * i + 1] = g - CENTER_OFFSET;
            positions[3 * i + 2] = b - CENTER_OFFSET;

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
        this.removePointCloud();
        this.pointCloud = new THREE.Points(geometry, material);
        this.scene.add(this.pointCloud);
    }

    createConvexHullCircles(vertices, faces, type = null) {
        if (!vertices || vertices.length === 0) return;
        if (type) this.displayedPalette = type;

        // Stockage de l'enveloppe selon le type
        if (type === "simplified") {
            this.convexHulls.simplified = {vertices, faces};
            this.original.convexHulls = JSON.parse(JSON.stringify({vertices, faces}));
        } else if (type === "initial") {
            this.convexHulls.initial = {vertices, faces};
        }

        this.clearOverlayMesh();

        // Création des groupes d'overlay
        this.overlayMesh.circle = new THREE.Object3D();
        this.overlayMesh.rims = new THREE.Object3D();
        this.overlayMesh.edges = new THREE.Object3D();

        const radius = 0.02;
        const radiusRim = radius * 1.2;
        const segments = 32;

        // Géométries et matériaux pour les cercles et contours
        const circleGeometry = new THREE.SphereGeometry(radius, segments, segments);
        const circleRimGeometry = new THREE.CircleGeometry(radiusRim, segments);
        const circleRimMaterial = new THREE.MeshBasicMaterial({color: 0xffffff});

        // Création des cercles et contours pour chaque sommet
        vertices.forEach((vertex, index) => {
            const pos = this.getCenteredVector(vertex);
            const color = new THREE.Color(vertex[0], vertex[1], vertex[2]).convertSRGBToLinear();
            const circleMaterial = new THREE.MeshBasicMaterial({color});
            const circle = new THREE.Mesh(circleGeometry, circleMaterial);
            circle.position.copy(pos);
            circle.userData.index = index;
            this.overlayMesh.circle.add(circle);

            const rim = new THREE.Mesh(circleRimGeometry, circleRimMaterial);
            rim.position.copy(pos);
            this.overlayMesh.rims.add(rim);
        });

        const edgeMaterial = new LineMaterial({
            linewidth: 3,
            color: 0xffffff,
            vertexColors: true,
        });

        // Fonction locale pour ajouter une arête entre deux points
        const addEdgeToScene = (v1, v2) => {
            const geometry = new LineGeometry();
            const flatPoints = [v1.x, v1.y, v1.z, v2.x, v2.y, v2.z];
            geometry.setPositions(new Float32Array(flatPoints));
            geometry.setColors(new Float32Array([1, 1, 1, 1, 1, 1]));
            const line = new Line2(geometry, edgeMaterial);
            this.overlayMesh.edges.add(line);
        };

        // On crée les arêtes à partir des faces
        faces.forEach(face => {
            for (let i = 0; i < face.length; i++) {
                const currentIndex = face[i];
                const nextIndex = face[(i + 1) % face.length];
                const v1 = this.getCenteredVector(vertices[currentIndex]);
                const v2 = this.getCenteredVector(vertices[nextIndex]);
                addEdgeToScene(v1, v2);
            }
        });

        // Ajout des groupes à la scène
        this.scene.add(this.overlayMesh.circle);
        this.scene.add(this.overlayMesh.rims);
        this.scene.add(this.overlayMesh.edges);
    }

    onWindowResize() {
        const container = document.getElementById("webgl-output");
        this.camera.aspect = container.clientWidth / container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(container.clientWidth, container.clientHeight);
    }

    animate() {
        // On fait en sorte que les contours des cercles regardent toujours vers la caméra
        if (this.overlayMesh.rims) {
            this.overlayMesh.rims.children.forEach(rim => rim.lookAt(this.camera.position));
        }
        requestAnimationFrame(this.animate.bind(this));
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
        this.stats.update();
    }

    onMouseDown(event) {
        if (this.weights.length !== this.convexHulls.simplified?.vertices.length) return;
        if (this.displayedPalette === "initial") return;
        event.preventDefault();

        const mouseCoords = this.getNormalizedMouse(event);
        this.mouse.set(mouseCoords.x, mouseCoords.y);

        // On lance un rayon pour détecter les intersections avec les cercles
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.overlayMesh.circle.children);

        // On ne retient que le premier point intersect
        if (intersects.length > 0) {
            document.body.style.cursor = "grabbing";
            this.controls.enabled = false;
            this.selectedPoint = intersects[0].object;
        }
    }

    onMouseMove(event) {
        if (!this.selectedPoint) return;
        event.preventDefault();

        if (!this.paletteChanged) {
            this.paletteChanged = true;
            document.getElementById("initial-palette").style.cursor = "not-allowed";
            document.getElementById("selected-palette").style.cursor = "default";
            document.getElementById("rollback-palette").classList.remove("hidden");
        }

        const mouseCoords = this.getNormalizedMouse(event);
        this.mouse.set(mouseCoords.x, mouseCoords.y);
        this.raycaster.setFromCamera(this.mouse, this.camera);

        // On crée un plan passant par la position du point et orienté selon la direction de la caméra
        const planeNormal = new THREE.Vector3();
        this.camera.getWorldDirection(planeNormal);
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, this.selectedPoint.position);
        const intersectPoint = new THREE.Vector3();
        this.raycaster.ray.intersectPlane(plane, intersectPoint);

        if (intersectPoint) {
            const index = this.selectedPoint.userData.index;
            this.selectedPoint.position.copy(intersectPoint);
            // Mise à jour du sommet dans l'enveloppe simplifiée
            this.convexHulls.simplified.vertices[index] = [
                intersectPoint.x + CENTER_OFFSET,
                intersectPoint.y + CENTER_OFFSET,
                intersectPoint.z + CENTER_OFFSET,
            ];
            // Mise à jour du contour et des arêtes
            this.overlayMesh.rims.children[index].position.copy(intersectPoint);
            this.updateAllEdges();

            const newColor = [
                Math.round((intersectPoint.x + CENTER_OFFSET) * 255),
                Math.round((intersectPoint.y + CENTER_OFFSET) * 255),
                Math.round((intersectPoint.z + CENTER_OFFSET) * 255),
            ];

            this.overlayMesh.circle.children[index].material.color.setRGB(
                newColor[0] / 255,
                newColor[1] / 255,
                newColor[2] / 255
            );
            this.paletteManager.updateColorAt(index, newColor);
            this.layerManager.updateLayer(
                {id: index, weights: this.weights[index]},
                this.paletteManager.getPalette()
            );
            this.layerManager.updateSumLayer(this.paletteManager.getPalette());
            this.updatePointCloud();
        }
    }

    onMouseUp(event) {
        event.preventDefault();
        this.selectedPoint = null;
        document.body.style.cursor = "auto";
        this.controls.enabled = true;
    }

    // ========================
    // Reconstruction à partir de l'image originale et des données initiales
    // ========================
    recreateFromOriginal() {
        const originalImage = document.getElementById("original-image");
        if (originalImage) {
            this.createPointCloud(originalImage);
        }
        if (this.convexHulls.initial) {
            this.createConvexHullCircles(
                this.convexHulls.initial.vertices,
                this.convexHulls.initial.faces,
                "initial"
            );
        }
    }

    addHarmonyButtonListener(button, id = null) {
        button.addEventListener("click", () => {
            const buttonId = id || button.id;
            const harmony = this.paletteManager.getHarmonyAt(id || buttonId);
            if (harmony && !button.disabled) {
                this.paletteManager.selectPalette(buttonId);
                this.rollback(buttonId);
                if (!this.paletteChanged) {
                    this.paletteChanged = true;
                    document.getElementById("initial-palette").style.cursor = "not-allowed";
                    document.getElementById("selected-palette").style.cursor = "default";
                    document.getElementById("rollback-palette").classList.remove("hidden");
                }
            }
        });
    }

    rollback(palette = null) {
        // Réinitialise la palette et restaure l'état initial à partir de l'image et des données originales
        this.paletteChanged = false;
        this.displayedPalette = "simplified";
        this.paletteManager.selectPalette(palette || "simplified");

        this.clearOverlayMesh();

        // Restauration de l'enveloppe simplifiée à partir des données originales
        this.convexHulls.simplified = JSON.parse(JSON.stringify(this.original.convexHulls));

        if (palette) {
            let vertices = this.paletteManager.getPalette();
            vertices.forEach(vertex => {
                vertex[0] /= 255;
                vertex[1] /= 255;
                vertex[2] /= 255;
            });
            this.convexHulls.simplified.vertices = vertices;
        }
        if (this.convexHulls.simplified) {
            this.createConvexHullCircles(
                this.convexHulls.simplified.vertices,
                this.convexHulls.simplified.faces
            );
        }

        const originalImage = document.getElementById("original-image");
        if (originalImage) {
            this.removePointCloud();
            this.createPointCloud(originalImage);
            this.updatePointCloud();
        }

        for (let index = 0; index < this.weights.length; index++) {
            this.layerManager.updateLayer(
                {id: index, weights: this.weights[index]},
                this.paletteManager.getPalette()
            );
        }
        this.layerManager.updateSumLayer(this.paletteManager.getPalette());
    }
}

export {ThreeSceneManager};