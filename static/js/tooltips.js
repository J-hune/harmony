import {computePosition, offset, flip, autoUpdate} from 'floating-ui';

class TooltipsManager {
    constructor() {
        this.tooltips = [
            {id: "harmonize", text: "Harmoniser les couleurs", placement: "left", delay: 200},
            {id: "download-palettes", text: "Télécharger les palettes", placement: "right", delay: 400},
            {id: "download-layers", text: "Télécharger les layers", placement: "right", delay: 400},
            {id: "rollback-palette", text: "Réinitialiser la palette", placement: "bottom-start", delay: 300},
            {id: "triadic-harmony", text: "Harmonie triadique", placement: "left"},
            {id: "complementary-harmony", text: "Harmonie complémentaire", placement: "left"},
            {id: "square-harmony", text: "Harmonie en carré", placement: "left"},
            {id: "split-harmony", text: "Harmonie divisée", placement: "left"},
            {id: "double-split-harmony", text: "Harmonie doublement divisée", placement: "left"},
            {id: "analogous-harmony", text: "Harmonie analogue", placement: "left"},
            {id: "monochromatic-harmony", text: "Harmonie monochromatique", placement: "left"}
        ];
    }

    /**
     * Initialise les tooltips.
     */
    init() {
        this.tooltips.forEach(tooltip => {
            // On crée l'élément du tooltip
            tooltip.target = document.getElementById(tooltip.id);
            tooltip.element = document.createElement('div');
            tooltip.element.className = 'tooltip';
            tooltip.element.role = 'tooltip';
            tooltip.element.innerHTML = tooltip.text;
            document.body.appendChild(tooltip.element);

            // Fonction de mise à jour de la position
            const updatePosition = () => {
                computePosition(tooltip.target, tooltip.element, {
                    placement: tooltip.placement,
                    middleware: [offset(8), flip()],
                    strategy: 'fixed'
                }).then(({x, y}) => {
                    Object.assign(tooltip.element.style, {
                        left: `${x}px`,
                        top: `${y}px`
                    });
                });
            };

            // On utilise autoUpdate pour recalculer la position lors des changements
            const cleanup = autoUpdate(tooltip.target, tooltip.element, updatePosition);

            let showTimeout;
            const show = () => {
                showTimeout = setTimeout(() => {
                    // Ne rien faire si la cible est désactivée ou n'est plus en hover
                    if (tooltip.target.hasAttribute('disabled')) return;
                    if (!tooltip.target.matches(':hover')) return;

                    tooltip.element.setAttribute('data-show', '');
                    updatePosition();
                }, tooltip.delay || 0);
            };

            const hide = () => {
                clearTimeout(showTimeout);
                tooltip.element.removeAttribute('data-show');
            };

            // Événements desktop et mobile
            const showEvents = ["mouseenter", "focus", "touchstart"];
            const hideEvents = ["pointerleave", "blur", "touchend", "touchcancel"];

            showEvents.forEach(event =>
                tooltip.target.addEventListener(event, show)
            );
            hideEvents.forEach(event =>
                tooltip.target.addEventListener(event, hide)
            );

            // On masque le tooltip lors d'un tap ailleurs sur mobile
            document.addEventListener("touchstart", (e) => {
                if (!tooltip.target.contains(e.target) && !tooltip.element.contains(e.target)) {
                    hide();
                }
            });
        });
    }
}

export {TooltipsManager};