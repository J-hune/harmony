import {createPopper} from "popper.js"

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


            // On crée l'instance du tooltip
            tooltip.instance = createPopper(tooltip.target, tooltip.element, {
                placement: tooltip.placement,
                modifiers: [{name: "offset", options: {offset: [0, 8]}}]
            });
            tooltip.instance.update();

            let showTimeout;
            function show() {
                showTimeout = setTimeout(() => {
                    // On ignore si l'élément a l'attribut disabled
                    if (tooltip.target.hasAttribute('disabled')) return;
                    if (!tooltip.target.matches(':hover')) return;

                    tooltip.element.setAttribute('data-show', '');

                    tooltip.instance.setOptions((options) => ({
                        ...options,
                        modifiers: [
                            ...options.modifiers,
                            {name: 'eventListeners', enabled: true},
                        ],
                    }));

                    tooltip.instance.update();
                }, tooltip.delay || 0); // Délai d'affichage en millisecondes (ici 1s)
            }

            function hide() {
                clearTimeout(showTimeout);
                tooltip.element.removeAttribute('data-show');

                // Disable the event listeners
                tooltip.instance.setOptions((options) => ({
                    ...options,
                    modifiers: [
                        ...options.modifiers,
                        {name: 'eventListeners', enabled: false},
                    ],
                }));
            }

            const showEvents = ["mouseenter", "focus"];
            const hideEvents = ["pointerleave", "blur"];

            showEvents.forEach((event) => tooltip.target.addEventListener(event, show));
            hideEvents.forEach((event) => tooltip.target.addEventListener(event, hide));
        });
    }
}

export {TooltipsManager};