import jszip from "jszip";

class PaletteManager {
    constructor() {
        this.initial = [];
        this.simplified = [];

        this.downloadButton = document.getElementById('download-palettes');
        this.downloadButton.addEventListener('click', () => {
            this.download();
        });
    }

    /**
     * Récupère les palettes initiale et simplifiée.
     *
     * @returns {Array<Array<Array<number>>>} - Un tableau contenant les palettes initiale et simplifiée, chacune représentée comme un tableau de couleurs RGB.
     */
    getPalettes() {
        return [this.initial, this.simplified];
    }

    /**
     * Crée une palette et met à jour le DOM pour l'afficher.
     *
     * @param {string} type - Le type de la palette ('initial' ou 'simplified').
     * @param {Array<Array<number>>} vertices - Un tableau de sommets où chaque sommet est une couleur RGB.
     */
    create(type, vertices) {
        // On affiche le titre et le conteneur de prévisualisation
        document.getElementById("palettes-title").classList.remove('hidden');
        document.getElementById("initial-palette").classList.remove('hidden');
        document.getElementById("simplified-palette").classList.remove('hidden');

        const palette = vertices.map(v => [Math.round(v[0] * 255), Math.round(v[1] * 255), Math.round(v[2] * 255)]);
        const paletteContainer = document.getElementById(type === 'initial' ? 'initial-palette' : 'simplified-palette');

        paletteContainer.innerHTML = '';
        palette.forEach(color => {
            const div = document.createElement('div');
            div.style.backgroundColor = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
            paletteContainer.appendChild(div);
        });

        if (type === 'initial') this.initial = palette;
        else this.simplified = palette;
    }

    /**
     * Génère un canvas représentant une palette de couleurs.
     *
     * @param {Array<Array<number>>} palette - Un tableau de couleurs, où chaque couleur est un tableau RGB.
     * @returns {HTMLCanvasElement} - Le canvas généré avec la palette de couleurs.
     */
    generateCanvas(palette) {
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 40;
        const ctx = canvas.getContext('2d');
        const colorWidth = Math.floor(canvas.width / palette.length);

        palette.forEach((color, i) => {
            ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
            ctx.fillRect(i * colorWidth, 0, colorWidth, canvas.height);
        });

        // On s'assure que le dernier bloc couvre toute la largeur restante
        ctx.fillRect(palette.length * colorWidth, 0, canvas.width - colorWidth * palette.length, canvas.height);

        return canvas;
    }

    /**
     * Télécharge les deux palettes sous forme de fichier ZIP.
     */
    download() {
        const zip = new jszip();

        // On crée un canvas pour chaque type de palette
        const initialCanvas = this.generateCanvas(this.initial);
        const simplifiedCanvas = this.generateCanvas(this.simplified);

        // On convertit les canvas en images PNG (data URL)
        const initialImage = initialCanvas.toDataURL('image/png');
        const simplifiedImage = simplifiedCanvas.toDataURL('image/png');

        // On ajoute les images dans le fichier ZIP
        zip.file('palette-initial.png', initialImage.split(',')[1], {base64: true});
        zip.file('palette-simplified.png', simplifiedImage.split(',')[1], {base64: true});

        // On génère le fichier ZIP et le télécharge
        zip.generateAsync({type: 'blob'}).then(function (content) {
            const a = document.createElement('a');
            const url = URL.createObjectURL(content);
            a.href = url;
            a.download = 'palettes.zip';
            a.click();
            URL.revokeObjectURL(url); // On libère l'URL après le téléchargement
        });
    }
}

export {PaletteManager};