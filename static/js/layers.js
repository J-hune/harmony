import jszip from 'jszip';

class LayerManager {
   constructor() {
      this.width = 0;
      this.height = 0;
      this.layers = [];
      this.layersContainer = document.getElementById('layers-container');
      this.downloadButton = document.getElementById('download-layers');
      // Le résultat est calculé en pleine résolution dans un canvas hors écran
      // (utilisé pour le téléchargement), puis recopié à la taille d'affichage
      // avec un lissage de qualité : réduire un grand canvas en CSS le pixélise.
      this.resultCanvas = document.createElement('canvas');
      this.harmonizedImage = document.getElementById('harmonized-image');
      this.resultView = document.getElementById('result-view');
      this.downloadResultButton = document.getElementById('download-result');

      new ResizeObserver(() => this.renderResult()).observe(this.resultView);

      this.downloadButton.addEventListener('click', () => {
         this.download();
      });

      this.downloadResultButton.addEventListener('click', () => {
         const a = document.createElement('a');
         a.href = this.resultCanvas.toDataURL('image/png');
         a.download = 'harmonized.png';
         a.click();
         a.remove();
      });
   }

   /**
    * Réinitialise le gestionnaire de couches
    */
   reset() {
      this.width = 0;
      this.height = 0;
      this.layers = [];
      this.layersContainer.innerHTML = '';
      this.downloadButton.classList.add('hidden');
      this.resultCanvas.width = this.resultCanvas.height = 0;
      this.harmonizedImage.width = this.harmonizedImage.height = 0;
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
         this.layersContainer.appendChild(canvas);
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
         data[pixelIndex] = color[0]; // Rouge
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
      document.getElementById('layers-section').classList.remove('hidden');

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
    * Recompose l'image à partir des couches : pixel = somme(poids × couleur).
    * Le calcul se fait en flottants puis l'image est opaque, comme la
    * reconstruction côté serveur (sinon les arrondis successifs rendent
    * certains pixels partiellement transparents).
    * @param {Array<Array<number>>} palette - Couleurs RGB (0-255) de chaque couche.
    */
   updateSumLayer(palette) {
      const numPixels = this.width * this.height;
      const rgb = new Float32Array(numPixels * 3);
      for (let i = 0; i < this.layers.length; i++) {
         const [r, g, b] = palette[i];
         const weights = this.layers[i];
         for (let j = 0; j < numPixels; j++) {
            const w = weights[j];
            rgb[j * 3] += w * r;
            rgb[j * 3 + 1] += w * g;
            rgb[j * 3 + 2] += w * b;
         }
      }

      const imageData = new ImageData(this.width, this.height);
      const data = imageData.data;
      for (let j = 0; j < numPixels; j++) {
         data[j * 4] = rgb[j * 3];
         data[j * 4 + 1] = rgb[j * 3 + 1];
         data[j * 4 + 2] = rgb[j * 3 + 2];
         data[j * 4 + 3] = 255;
      }

      this.resultCanvas.width = this.width;
      this.resultCanvas.height = this.height;
      this.resultCanvas.getContext('2d').putImageData(imageData, 0, 0);
      this.renderResult();
   }

   /**
    * Affiche le résultat à la plus grande taille possible dans sa zone,
    * à la résolution de l'écran, sans jamais l'agrandir au-delà de 100 %.
    */
   renderResult() {
      const { width, height } = this.resultCanvas;
      if (!width || !height) return;

      const scale = Math.min(
         this.resultView.clientWidth / width,
         this.resultView.clientHeight / height,
         1,
      );
      const cssWidth = Math.max(1, Math.floor(width * scale));
      const cssHeight = Math.max(1, Math.floor(height * scale));
      const dpr = window.devicePixelRatio || 1;

      const canvas = this.harmonizedImage;
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      canvas.width = Math.min(width, Math.round(cssWidth * dpr));
      canvas.height = Math.min(height, Math.round(cssHeight * dpr));

      // Réduction par moitiés successives : une seule forte réduction crée de l'aliasing
      let source = this.resultCanvas;
      let sw = width;
      let sh = height;
      while (sw / 2 >= canvas.width && sh / 2 >= canvas.height) {
         const step = document.createElement('canvas');
         step.width = Math.ceil(sw / 2);
         step.height = Math.ceil(sh / 2);
         const stepCtx = step.getContext('2d');
         stepCtx.imageSmoothingQuality = 'high';
         stepCtx.drawImage(source, 0, 0, sw, sh, 0, 0, step.width, step.height);
         source = step;
         sw = step.width;
         sh = step.height;
      }

      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, sw, sh, 0, 0, canvas.width, canvas.height);
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
         zip.file(`layer-${i}.png`, dataURL.split(',')[1], { base64: true });
      }

      // On génère le fichier ZIP et on le télécharge
      zip.generateAsync({ type: 'blob' }).then((content) => {
         const url = URL.createObjectURL(content);
         const a = document.createElement('a');
         a.href = url;
         a.download = 'layers.zip';
         a.click();
         URL.revokeObjectURL(url); // On libère l'URL après le téléchargement
      });
   }
}

export { LayerManager };
