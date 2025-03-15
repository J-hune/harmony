class TerminalManager {
    constructor() {
        this.thinkingInterval = null;
        this.thinkingElement = null;
        this.terminal = document.getElementById('terminal');
    }

    /**
     * Affiche un message dans le terminal de l'application.
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
        this.terminal.scrollTop = this.terminal.scrollHeight;
    }

    /**
     * Démarre l'animation du spinner.
     */
    startThinking() {
        if (this.thinkingElement) return;
        this.thinkingElement = document.createElement('p');
        this.thinkingElement.id = 'thinking-indicator';
        this.thinkingElement.textContent = '‎';
        this.terminal.appendChild(this.thinkingElement);

        const states = ["▹▹▹▹▹", "▸▹▹▹▹", "▹▸▹▹▹", "▹▹▸▹▹", "▹▹▹▸▹", "▹▹▹▹▸"];
        let index = 0;
        this.thinkingInterval = setInterval(() => {
            index = (index + 1) % states.length;
            this.thinkingElement.textContent = states[index];
        }, 120);
    }

    /**
     * Arrête l'animation du spinner
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
}

export {TerminalManager};