import jszip from "jszip";

class LayerManager {
    constructor() {
        this.width = 0;
        this.height = 0;
        this.layers = [];
        this.layersContainer = document.getElementById('layers-container');
        this.downloadButton = document.getElementById('download-layers');
        this.harmonizedImage = document.getElementById('harmonized-image');

        this.downloadButton.addEventListener('click', () => {
            this.download();
        });

        this.harmonizedImage.addEventListener('click', () => {
            const a = document.createElement('a');
            a.href = this.harmonizedImage.toDataURL('image/png');
            a.download = 'harmonized.png';
            a.click();
            a.remove();
        });
    }

    /**
     * Trouve ou crée un canvas pour une couche donnée et le retourne
     * @param {Object} data - Les données de la couche
     * @param {number} data.width - La largeur de la couche
     * @param {number} data.height - La hauteur de la couche
     * @param {number} data.id - L'identifiant de la couche
     * @param {Float32Array} data.weights - Les poids de la couche (tableau de flottants)
     * @returns {HTMLElement} - Le canvas créé ou trouvé
     */
    createCanvasForLayer(data) {
        let canvas = document.getElementById(`layer-${data.id}`);
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.width = data.width;
            canvas.height = data.height;
            canvas.id = `layer-${data.id}`;
            canvas.style.backgroundColor = "#212121";
            this.layersContainer.insertBefore(canvas, this.downloadButton);
        }
        return canvas;
    }

    /**
     * Génère les données RGBA pour une image à partir des poids de la couche
     * @param {Float32Array} weights - Les poids de la couche (tableau de flottants)
     * @param {number} width - La largeur de l'image
     * @param {number} height - La hauteur de l'image
     * @param {number[]} color - La couleur de la couche (tableau de 3 entiers)
     * @returns {ImageData} - Le nouveau tableau de données RGBA
     */
    generateRGBAImageData(weights, width, height, color) {
        const imageData = new ImageData(width, height);
        const data = imageData.data;

        // Pour chaque poids (grey), on crée un pixel rgba
        for (let i = 0; i < weights.length; i++) {
            const pixelIndex = i * 4;
            data[pixelIndex] = color[0];   // Rouge
            data[pixelIndex + 1] = color[1]; // Vert
            data[pixelIndex + 2] = color[2]; // Bleu
            data[pixelIndex + 3] = weights[i] * 255; // Alpha
        }

        return imageData;
    }

    /**
     * Crée ou met à jour la couche sur l'interface utilisateur : couche = weights * couleur
     * @param {Object} data - Les données de la couche
     * @param {number} data.width - La largeur de la couche
     * @param {number} data.height - La hauteur de la couche
     * @param {number} data.id - L'identifiant de la couche
     * @param {Float32Array} data.weights - Les poids de la couche (tableau de flottants)
     * @param palette - La palette (tableau de couleurs)
     */
    updateLayer(data, palette) {
        // On affiche les éléments du DOM
        if (document.getElementById('layers-title').classList.contains('hidden')) {
            document.getElementById('layers-title').classList.remove('hidden');
            this.layersContainer.classList.remove('hidden');
        }

        // On crée ou récupère le canvas de la couche
        const canvas = this.createCanvasForLayer(data);
        const ctx = canvas.getContext('2d');

        // On transforme les poids en pixels RGBA
        // ici on multiplie par la couleur de la palette mais c'est purement esthétique
        const width = data.width || this.width;
        const height = data.height || this.height;
        const imageData = this.generateRGBAImageData(data.weights, width, height, palette[data.id]);

        // On met à jour le canvas
        ctx.putImageData(imageData, 0, 0);
        this.width = width;
        this.height = height;
        this.layers[data.id] = data.weights;
    }

    /**
     * Crée ou modifie le canvas représentant la somme des couches
     */
    updateSumLayer(simplifiedPalette) {
        // Pour chaque couche, on multiplie les poids par la couleur de la palette
        const imageData = new ImageData(this.width, this.height);
        const data = imageData.data;
        for (let i = 0; i < this.layers.length; i++) {
            const color = simplifiedPalette[i];
            for (let j = 0; j < this.layers[i].length; j++) {
                const pixelIndex = j * 4;
                data[pixelIndex] += this.layers[i][j] * color[0];   // Rouge
                data[pixelIndex + 1] += this.layers[i][j] * color[1]; // Vert
                data[pixelIndex + 2] += this.layers[i][j] * color[2]; // Bleu
                data[pixelIndex + 3] += this.layers[i][j] * 255; // Alpha
            }
        }

        // On met à jour le canvas
        this.harmonizedImage.width = this.width;
        this.harmonizedImage.height = this.height;
        const ctx = this.harmonizedImage.getContext('2d');
        ctx.putImageData(imageData, 0, 0);
        this.harmonizedImage.classList.remove('hidden');
    }

    /**
     * Télécharge les couches sous forme d'image
     */
    download() {
        const zip = new jszip();

        // Les couches sont déjà en canvas dans le DOM sous l'id layer-*
        for (let i = 0; i < this.layers.length; i++) {
            const canvas = document.getElementById(`layer-${i}`);
            const dataURL = canvas.toDataURL('image/png');
            zip.file(`layer-${i}.png`, dataURL.split(',')[1], {base64: true});
        }

        // On génère le fichier ZIP et on le télécharge
        zip.generateAsync({type: 'blob'}).then((content) => {
            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'layers.zip';
            a.click();
            URL.revokeObjectURL(url); // On libère l'URL après le téléchargement
        });
    }
}


export {LayerManager};