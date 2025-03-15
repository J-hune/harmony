class TerminalManager {
    constructor(ThreeSceneManager) {
        this.threeSceneManager = ThreeSceneManager;
        this.thinkingInterval = null;
        this.thinkingElement = null;
        this.terminal = document.getElementById('terminal');
        this.terminalContainer = document.getElementById('terminal-container');
        this.slider = document.getElementById('terminal-slider');

        // Récupération de la marge intérieure (padding) du terminal-container
        this.terminalPadding = parseInt(
            window.getComputedStyle(this.terminalContainer).paddingTop,
            10
        );

        // Initialisation de la position "bottom" du slider selon la hauteur du container + padding
        const containerHeight = parseInt(
            window.getComputedStyle(this.terminalContainer).height,
            10
        );
        this.slider.style.bottom = `${containerHeight + this.terminalPadding}px`;

        // Ajout de l'événement 'mousedown' sur le slider pour démarrer le redimensionnement
        this.slider.addEventListener('mousedown', (event) => {
            event.preventDefault();

            // On change le curseur pour indiquer l'action de redimensionnement
            document.body.style.cursor = 'ns-resize';

            // On calcule l'offset entre la position du curseur et le haut du slider
            const sliderRect = this.slider.getBoundingClientRect();
            this.offsetY = event.clientY - sliderRect.top;
            this.startY = event.clientY;
            this.startHeight = parseInt(this.slider.style.bottom, 10);

            // On bind la fonction de redimensionnement pour conserver le contexte "this"
            this.boundResizeTerminal = this.resizeTerminal.bind(this);
            document.addEventListener('mousemove', this.boundResizeTerminal);

            // On définit un gestionnaire pour l'événement "mouseup" pour mettre fin au redimensionnement
            const mouseUpHandler = () => {
                document.body.style.cursor = 'auto';
                document.removeEventListener('mousemove', this.boundResizeTerminal);
                document.removeEventListener('mouseup', mouseUpHandler);
            };
            document.addEventListener('mouseup', mouseUpHandler);
        });
    }

    /**
     * Affiche un message dans le terminal.
     * @param {string} message - Message à afficher.
     * @param {string} [type='info'] - Type de message ('info' ou 'error').
     */
    logMessage(message, type = 'info') {
        const p = document.createElement('p');
        p.textContent = message;
        if (type === 'error') p.style.color = 'red';

        // On cherche si un thinking-indicator est présent pour placer le message avant
        const thinkingIndicator = document.getElementById('thinking-indicator');
        if (thinkingIndicator) {
            this.terminal.insertBefore(p, thinkingIndicator);
        } else {
            this.terminal.appendChild(p);
        }

        // On défile pour afficher le dernier message
        this.terminal.scrollTop = this.terminal.scrollHeight;
    }

    /**
     * Démarre l'animation du spinner de chargement dans le terminal.
     */
    startThinking() {
        if (this.thinkingElement) return;
        this.thinkingElement = document.createElement('p');
        this.thinkingElement.id = 'thinking-indicator';
        this.thinkingElement.textContent = '‎';
        this.terminal.appendChild(this.thinkingElement);

        const states = ["▹▹▹▹▹", "▸▹▹▹▹", "▹▸▹▹▹", "▹▹▸▹▹", "▹▹▹▸▹", "▹▹▹▹▸"];
        let index = 0;

        // On lance l'animation avec un intervalle régulier
        this.thinkingInterval = setInterval(() => {
            index = (index + 1) % states.length;
            this.thinkingElement.textContent = states[index];
        }, 120);
    }

    /**
     * Arrête l'animation du spinner de chargement.
     */
    stopThinking() {
        if (this.thinkingInterval) {
            clearInterval(this.thinkingInterval);
            this.thinkingInterval = null;
        }
        if (this.thinkingElement) {
            this.thinkingElement.parentNode.removeChild(this.thinkingElement);
            this.thinkingElement = null;
        }
    }

    /**
     * Redimensionne le terminal en fonction du déplacement vertical de la souris.
     * @param {MouseEvent} event - L'événement 'mousemove' lors du redimensionnement.
     */
    resizeTerminal(event) {
        // On calcule la nouvelle position "bottom" du slider
        const sliderBottom = this.startHeight - (event.clientY - this.startY) - this.offsetY;
        if (sliderBottom < 40) return;

        // On met à jour la position du slider
        this.slider.style.bottom = `${sliderBottom}px`;

        // On met à jour la hauteur du terminal-container en tenant compte du padding
        this.terminalContainer.style.height = `${sliderBottom - this.terminalPadding}px`;
        document.getElementById("webgl-output").style.bottom = `${sliderBottom - this.terminalPadding}px`;
        this.terminal.scrollTop = this.terminal.scrollHeight
        this.threeSceneManager.onWindowResize();
    }
}

export { TerminalManager };
