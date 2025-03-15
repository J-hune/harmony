import * as THREE from "three";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls";
import {LineGeometry} from "three/examples/jsm/lines/LineGeometry";
import {LineMaterial} from "three/examples/jsm/lines/LineMaterial";
import {Line2} from "three/examples/jsm/lines/Line2";
import Stats from "stats";

class ThreeSceneManager {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.pointCloud = null;
        this.overlayMesh = {};
        this.stats = null;
        this.convexHulls = {};

        document.getElementById("initial-palette").addEventListener("click", () => {
            this.createConvexHullCircles(this.convexHulls.initial.vertices, this.convexHulls.initial.faces);
        });

        document.getElementById("simplified-palette").addEventListener("click", () => {
            this.createConvexHullCircles(this.convexHulls.simplified.vertices, this.convexHulls.simplified.faces);
        });
    }

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

        // On initialise stats.js (pour les fps)
        this.stats = new Stats();
        this.stats.dom.style.position = "absolute";
        this.stats.dom.style.top = "0";
        this.stats.dom.style.right = "0";
        this.stats.dom.style.left = "auto";
        document.body.appendChild(this.stats.dom);

        // Gestion de l'événement de redimensionnement
        window.addEventListener("resize", this.onWindowResize.bind(this), false);


        this.buildRgbCube(); // On ajoute le cube représentant l'espace RGB
        this.animate(); // On lance la boucle d'animation
    }

    /**
     * Réinitialise la scène en supprimant le nuage de points et les éléments de superposition.
     */
    reset() {
        if (this.pointCloud) {
            this.scene.remove(this.pointCloud);
            if (this.overlayMesh.rims) this.scene.remove(this.overlayMesh.rims);
            if (this.overlayMesh.circle) this.scene.remove(this.overlayMesh.circle);
            if (this.overlayMesh.edges) this.scene.remove(this.overlayMesh.edges);
            this.overlayMesh = {};
        }
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
            linewidth: 0.004,
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
     * Construit un cube RGB avec lignes et arêtes.
     */
    buildRgbCube() {
        const axes = new THREE.Object3D();
        const offset = 0.5; // Décalage pour centrer le cube dans [-0.5, 0.5]

        // Axes et arêtes du cube
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

        const material = new THREE.PointsMaterial({size: 0.01, vertexColors: true});
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

        if (type === "simplified") {
            this.convexHulls.simplified = {vertices, faces};
        } else if (type === "initial") {
            this.convexHulls.initial = {vertices, faces};
        }

        // On supprime les éléments existants
        if (this.overlayMesh.circle) this.scene.remove(this.overlayMesh.circle);
        if (this.overlayMesh.rims) this.scene.remove(this.overlayMesh.rims);
        if (this.overlayMesh.edges) this.scene.remove(this.overlayMesh.edges);

        this.overlayMesh.circle = new THREE.Object3D();
        this.overlayMesh.rims = new THREE.Object3D();
        this.overlayMesh.edges = new THREE.Object3D();

        const radius = 0.02;
        const radiusRim = radius * 1.2;
        const segments = 32;

        // Géométries et matériaux pour les cercles et contours
        const circleGeometry = new THREE.SphereGeometry(radius, segments, segments);
        const circleRimGeometry = new THREE.CircleGeometry(radiusRim, segments);
        const circleRimMaterial = new THREE.MeshBasicMaterial({color: 0xFFFFFF});

        vertices.forEach(vertex => {
            // On crée le cercle pour chaque sommet
            const color = new THREE.Color(vertex[0], vertex[1], vertex[2]).convertSRGBToLinear();
            const circleMaterial = new THREE.MeshBasicMaterial({color});
            const circle = new THREE.Mesh(circleGeometry, circleMaterial);
            circle.position.set(vertex[0] - 0.5, vertex[1] - 0.5, vertex[2] - 0.5);
            this.overlayMesh.circle.add(circle);

            // On crée le contour du cercle
            const rim = new THREE.Mesh(circleRimGeometry, circleRimMaterial);
            rim.position.set(vertex[0] - 0.5, vertex[1] - 0.5, vertex[2] - 0.5);
            this.overlayMesh.rims.add(rim);
        });

        const edgeMaterial = new LineMaterial({
            linewidth: 0.003,
            color: 0xffffff,
            vertexColors: true,
        });

        // Fonction locale pour ajouter une arête entre deux points
        const addEdgeToScene = (v1, v2) => {
            const points = [v1, v2];
            const geometry = new LineGeometry();
            const flatPoints = points.map(p => [p.x, p.y, p.z]).flat();
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
                const v1 = new THREE.Vector3(
                    vertices[currentIndex][0] - 0.5,
                    vertices[currentIndex][1] - 0.5,
                    vertices[currentIndex][2] - 0.5
                );
                const v2 = new THREE.Vector3(
                    vertices[nextIndex][0] - 0.5,
                    vertices[nextIndex][1] - 0.5,
                    vertices[nextIndex][2] - 0.5
                );
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
}

export {ThreeSceneManager};
