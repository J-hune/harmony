import jszip from "jszip";

class PaletteManager {
    constructor() {
        this.initial = [];
        this.simplified = [];
        this.harmonies = {};
        this.selected = null;

        this.downloadButton = document.getElementById('download-palettes');
        this.downloadButton.addEventListener('click', () => {
            this.download();
        });
    }

    reset() {
        this.initial = [];
        this.simplified = [];
        this.harmonies = {};
        this.selected = null;
    }

    /**
     * Récupère la palette sélectionnée.
     *
     * @returns {Array<Array<number>>} - Un tableau contenant une palette représentée par un de couleurs RGB.
     */
    getPalette() {
        return JSON.parse(JSON.stringify(this.selected));
    }

    /**
     * Récupère la palette initiale.
     * @returns {Array<Array<number>>}
     */
    getOriginalSimplified() {
        return this.simplified;
    }

    /**
     * Récupère l'harmonie sélectionnée.
     * @param {string} name - Le nom de l'harmonie.
     */
    getHarmonyAt(name) {
        return this.harmonies[name];
    }

    /**
     * Copie et sélectionne la palette demandée.
     * @param name - Le nom de la palette à sélectionner : 'initial', 'simplified' ou le nom d'une harmonie.
     */
    selectPalette(name) {
        if (name === 'initial') this.selected = JSON.parse(JSON.stringify(this.initial));
        else if (name === 'simplified') this.selected = JSON.parse(JSON.stringify(this.simplified));
        else if (name in this.harmonies) this.selected = JSON.parse(JSON.stringify(this.harmonies[name].palette));

        // On met à jour les couleurs dans le DOM
        const selectedPalette = document.getElementById('selected-palette');
        for (let i = 0; i < selectedPalette.children.length; i++) {
            selectedPalette.children[i].style.backgroundColor = `rgb(${this.selected[i][0]}, ${this.selected[i][1]}, ${this.selected[i][2]})`;
        }
    }

    /**
     * Récupère toutes les harmonies.
     * @param harmonies
     */
    setHarmonies(harmonies) {
        this.harmonies = harmonies;
    }

    /**
     * Modifie une couleur de la palette simplifiée.
     * @param {number} index - L'index de la couleur à modifier.
     * @param {Array<number>} color - La nouvelle couleur RGB.
     */
    updateColorAt(index, color) {
        this.selected[index] = color;

        // On met à jour la couleur dans le DOM
        const selectedPalette = document.getElementById('selected-palette');
        selectedPalette.children[index].style.backgroundColor = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
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
        document.getElementById("selected-palette").classList.remove('hidden');

        const palette = vertices.map(v => [Math.round(v[0] * 255), Math.round(v[1] * 255), Math.round(v[2] * 255)]);
        const paletteContainer = document.getElementById(type === 'initial' ? 'initial-palette' : 'selected-palette');

        paletteContainer.innerHTML = '';
        palette.forEach(color => {
            const div = document.createElement('div');
            div.style.backgroundColor = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
            paletteContainer.appendChild(div);
        });

        if (type === 'initial') this.initial = palette;
        else {
            this.simplified = JSON.parse(JSON.stringify(palette))
            this.selected = palette;
        }
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
        const canvas = this.generateCanvas(this.selected);

        // On convertit les canvas en images PNG (data URL)
        const initialImage = initialCanvas.toDataURL('image/png');
        const simplifiedImage = canvas.toDataURL('image/png');

        // On ajoute les images dans le fichier ZIP
        zip.file('palette-initial.png', initialImage.split(',')[1], {base64: true});
        zip.file('palette-harmonized.png', simplifiedImage.split(',')[1], {base64: true});

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