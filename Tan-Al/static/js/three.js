import * as THREE from "three";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls.js";
import {LineGeometry} from "three/examples/jsm/lines/LineGeometry.js";
import {LineMaterial} from "three/examples/jsm/lines/LineMaterial.js";
import {Line2} from "three/examples/jsm/lines/Line2.js";
import Stats from "stats";

// Définition d'une constante pour le décalage pour centrer les coordonnées RGB
const CENTER_OFFSET = 0.5;

class ThreeSceneManager {
    constructor(paletteManager, layerManager) {
        this.paletteManager = paletteManager;
        this.layerManager = layerManager;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.pointCloud = null;
        this.overlayMesh = {};
        this.stats = null;
        this.convexHulls = {};
        this.weights = [];
        this.paletteChanged = false;
        this.displayedPalette = "initial";
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.selectedPoint = null;
        this.original = {};

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

    updateAllEdges() {
        // Met à jour toutes les positions des arêtes pour refléter les nouvelles positions des sommets
        if (!this.convexHulls.simplified) return;
        this.overlayMesh.edges.children.forEach((line, i) => {
            const faceIndex = Math.floor(i / 3); // supposer que chaque face est un triangle
            const vertexIndex = i % 3;
            const face = this.convexHulls.simplified.faces[faceIndex];
            const v1 = this.getCenteredVector(this.convexHulls.simplified.vertices[face[vertexIndex]]);
            const v2 = this.getCenteredVector(this.convexHulls.simplified.vertices[face[(vertexIndex + 1) % face.length]]);
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

        document.getElementById("simplified-palette").addEventListener("click", () => {
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
    }

    // ========================
    // Initialisation de la scène et gestion globale
    // ========================

    /**
     * Initialise la scène 3D, la caméra, le renderer, les contrôles et les stats.
     */
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
        container.parentElement.appendChild(this.stats.dom);

        // Gestion de l'événement de redimensionnement
        window.addEventListener("resize", this.onWindowResize.bind(this), false);

        // Ajout des listeners pour le déplacement des points
        this.renderer.domElement.addEventListener("mousedown", this.onMouseDown.bind(this), false);
        this.renderer.domElement.addEventListener("mousemove", this.onMouseMove.bind(this), false);
        this.renderer.domElement.addEventListener("mouseup", this.onMouseUp.bind(this), false);

        this.buildRgbCube(); // On ajoute le cube représentant l'espace RGB
        this.animate(); // On lance la boucle d'animation
    }

    /**
     * Réinitialise la scène en supprimant le nuage de points et les éléments de superposition.
     */
    reset() {
        // Réinitialisation du curseur des palettes
        document.getElementById("initial-palette").style.cursor = "pointer";
        document.getElementById("simplified-palette").style.cursor = "pointer";
        this.paletteChanged = false;
        this.displayedPalette = "initial";
        this.convexHulls = {};
        this.weights = [];

        // Suppression du nuage de points de la scène
        if (this.pointCloud) {
            this.scene.remove(this.pointCloud);
            this.pointCloud.geometry.dispose();
            this.pointCloud.material.dispose();
            this.pointCloud = null;
        }

        // Suppression de tous les groupes d'overlay (cercles, contours, arêtes)
        Object.values(this.overlayMesh).forEach((group) => {
            if (group) this.scene.remove(group);
        });
        this.overlayMesh = {};
    }

    /**
     * Ajoute les poids d'une couche.
     */
    addLayerWeights(weights, id) {
        this.weights[id] = weights;
    }

    /**
     * Met à jour le nuage de points 3D avec les poids.
     */
    updatePointCloud() {
        const palette = this.paletteManager.getPalettes()[1];
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

    /**
     * Crée une ligne avec un dégradé de couleur entre deux points.
     * @param {THREE.Vector3} position0 - Point de départ.
     * @param {THREE.Vector3} position1 - Point d'arrivée.
     * @param {THREE.Color} color0 - Couleur au point de départ.
     * @param {THREE.Color} color1 - Couleur au point d'arrivée.
     * @returns {Line2} La ligne créée.
     */
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

    /**
     * Construit un cube RGB avec axes et arêtes.
     */
    buildRgbCube() {
        const axes = new THREE.Object3D();
        const offset = CENTER_OFFSET; // Pour centrer le cube dans [-0.5, 0.5]

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

    /**
     * Crée un nuage de points 3D à partir d'une image.
     * @param {HTMLImageElement} img - Image source.
     */
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

        const material = new THREE.PointsMaterial({ size: 0.01, vertexColors: true });
        if (this.pointCloud) {
            this.scene.remove(this.pointCloud);
            this.pointCloud.geometry.dispose();
            this.pointCloud.material.dispose();
        }
        this.pointCloud = new THREE.Points(geometry, material);
        this.scene.add(this.pointCloud);
    }

    /**
     * Crée les éléments 3D (cercles, contours et arêtes) pour représenter l'enveloppe convexe.
     * @param {Array} vertices - Liste des sommets.
     * @param {Array} faces - Liste des faces (indices des sommets).
     * @param {string | null} type - Type de l'enveloppe convexe (simplified ou original).
     */
    createConvexHullCircles(vertices, faces, type = null) {
        if (!vertices || vertices.length === 0) return;
        if (type !== null) this.displayedPalette = type;

        // Stockage de l'enveloppe selon le type
        if (type === "simplified") {
            this.convexHulls.simplified = {vertices, faces};
            this.original.convexHulls = JSON.parse(JSON.stringify({vertices, faces}));
        } else if (type === "initial") {
            this.convexHulls.initial = {vertices, faces};
        }

        // On supprime les éléments existants
        if (this.overlayMesh.circle) this.scene.remove(this.overlayMesh.circle);
        if (this.overlayMesh.rims) this.scene.remove(this.overlayMesh.rims);
        if (this.overlayMesh.edges) this.scene.remove(this.overlayMesh.edges);

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
            // On crée le cercle pour chaque sommet
            const color = new THREE.Color(vertex[0], vertex[1], vertex[2]).convertSRGBToLinear();
            const circleMaterial = new THREE.MeshBasicMaterial({ color });
            const circle = new THREE.Mesh(circleGeometry, circleMaterial);
            circle.position.copy(pos);
            circle.userData.index = index;
            this.overlayMesh.circle.add(circle);

            // On crée le contour du cercle
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

    /**
     * Met à jour la caméra et le renderer lors du redimensionnement de la fenêtre.
     */
    onWindowResize() {
        const container = document.getElementById("webgl-output");
        this.camera.aspect = container.clientWidth / container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(container.clientWidth, container.clientHeight);
    }

    /**
     * Boucle d'animation principale.
     */
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
        // On vérifie que le nuage de points et l'enveloppe simplifiée sont présents
        if (this.weights.length !== this.convexHulls.simplified?.vertices.length) return;
        if (this.displayedPalette === "initial") return;

        this.container = document.getElementById("webgl-output");
        event.preventDefault();

        const mouseCoords = this.getNormalizedMouse(event);
        this.mouse.set(mouseCoords.x, mouseCoords.y);

        // On lance un rayon pour détecter les intersections avec les cercles
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.overlayMesh.circle.children);

        // On ne retient que le premier point intersect
        if (intersects.length > 0) {
            // On change le pointeur de la souris
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
            document.getElementById("simplified-palette").style.cursor = "default";
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

            // Mise à jour des sommets de l'enveloppe simplifiée
            this.convexHulls.simplified.vertices[index] = [
                intersectPoint.x + CENTER_OFFSET,
                intersectPoint.y + CENTER_OFFSET,
                intersectPoint.z + CENTER_OFFSET,
            ];

            // Mise à jour du contour du cercle
            this.overlayMesh.rims.children[index].position.copy(intersectPoint);

            // Mise à jour des arêtes
            this.updateAllEdges();

            // Calcul de la nouvelle couleur
            const newColor = [
                Math.round((intersectPoint.x + CENTER_OFFSET) * 255),
                Math.round((intersectPoint.y + CENTER_OFFSET) * 255),
                Math.round((intersectPoint.z + CENTER_OFFSET) * 255),
            ];

            // Mise à jour du point et de la palette
            this.overlayMesh.circle.children[index].material.color.setRGB(
                newColor[0] / 255,
                newColor[1] / 255,
                newColor[2] / 255
            );
            this.paletteManager.updateColorAt(index, newColor);
            this.layerManager.updateLayer({
                id: index,
                weights: this.weights[index],
            }, this.paletteManager.getPalettes()[1]);
            this.layerManager.updateSumLayer(this.paletteManager.getPalettes()[1]);
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
        // Recrée le nuage de points à partir de l'image originale
        const originalImage = document.getElementById("original-image");
        if (originalImage) {
            this.createPointCloud(originalImage);
        }

        // Recrée les overlays à partir du convex hull initial (s'il existe)
        if (this.convexHulls.initial) {
            this.createConvexHullCircles(
                this.convexHulls.initial.vertices,
                this.convexHulls.initial.faces,
                "initial"
            );
        }
    }

    rollback() {
        // Réinitialise la palette et rétablit l'état initial à partir de l'image originale et des données initiales
        this.paletteChanged = false;
        this.displayedPalette = "simplified";
        this.paletteManager.rollback();

        // Supprime les overlays actuels
        if (this.overlayMesh.circle) this.scene.remove(this.overlayMesh.circle);
        if (this.overlayMesh.rims) this.scene.remove(this.overlayMesh.rims);
        if (this.overlayMesh.edges) this.scene.remove(this.overlayMesh.edges);
        this.overlayMesh = {};

        // Recrée les overlays du convex hull initial
        this.convexHulls.simplified = JSON.parse(JSON.stringify(this.original.convexHulls));
        if (this.convexHulls.simplified) {
            this.createConvexHullCircles(
                this.convexHulls.simplified.vertices,
                this.convexHulls.simplified.faces,
            );
        } else {
            console.log("non")
        }

        // Recrée le nuage de points depuis l'image originale
        const originalImage = document.getElementById("original-image");
        if (originalImage) {
            if (this.pointCloud) {
                this.scene.remove(this.pointCloud);
                this.pointCloud.geometry.dispose();
                this.pointCloud.material.dispose();
                this.pointCloud = null;
            }
            this.createPointCloud(originalImage);
        }

        // Mise à jour des couches
        for (let index = 0; index < this.weights.length; index++) {
            this.layerManager.updateLayer({
                id: index,
                weights: this.weights[index],
            }, this.paletteManager.getPalettes()[1]);
        }
        this.layerManager.updateSumLayer(this.paletteManager.getPalettes()[1]);
    }
}

export {ThreeSceneManager};
