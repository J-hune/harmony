import {createPopper} from "popper.js"

class TooltipsManager {
    constructor() {
        this.tooltips = [{
            target: document.getElementById('harmonize'),
            text: 'Harmoniser les couleurs',
            offset: [0, 8],
            placement: 'left',
            delay: 300
        }, {
            target: document.getElementById('download-palettes'),
            text: 'Télécharger les palettes',
            offset: [0, 8],
            placement: 'right',
            delay: 400
        }, {
            target: document.getElementById('download-layers'),
            text: 'Télécharger les layers',
            offset: [0, 8],
            placement: 'right',
            delay: 400
        }, {
            target: document.getElementById('rollback-palette'),
            text: 'Réinitialiser la palette',
            offset: [0, 8],
            placement: 'bottom-start',
            delay: 300
        }];

        // On ajoute les tooltips pour les harmonies
        this.tooltips = this.tooltips.concat([{
            target: document.getElementById('triadic-harmony'),
            text: 'Harmonie triadique',
            offset: [0, 8],
            placement: 'left',
            delay: 400
        }, {
            target: document.getElementById('complementary-harmony'),
            text: 'Harmonie complémentaire',
            offset: [0, 8],
            placement: 'left',
            delay: 400
        }, {
            target: document.getElementById('square-harmony'),
            text: 'Harmonie en carré',
            offset: [0, 8],
            placement: 'left',
            delay: 400
        }, {
            target: document.getElementById('split-harmony'),
            text: 'Harmonie divisée',
            offset: [0, 8],
            placement: 'left',
            delay: 400
        }, {
            target: document.getElementById('double-split-harmony'),
            text: 'Harmonie doublement divisée',
            offset: [0, 8],
            placement: 'left',
            delay: 400
        }, {
            target: document.getElementById('analogous-harmony'),
            text: 'Harmonie analogue',
            offset: [0, 8],
            placement: 'left',
            delay: 400
        }, {
            target: document.getElementById('monochromatic-harmony'),
            text: 'Harmonie monochromatique',
            offset: [0, 8],
            placement: 'left',
            delay: 400
        }]);
    }

    /**
     * Initialise les tooltips.
     */
    init() {
        this.tooltips.forEach(tooltip => {
            // On crée l'élément du tooltip
            tooltip.element = document.createElement('div');
            tooltip.element.className = 'tooltip';
            tooltip.element.role = 'tooltip';
            tooltip.element.innerHTML = tooltip.text;
            document.body.appendChild(tooltip.element);


            // On crée l'instance du tooltip
            tooltip.instance = createPopper(tooltip.target, tooltip.element, {
                placement: tooltip.placement,
                modifiers: [
                    {
                        name: 'offset',
                        options: {
                            offset: tooltip.offset,
                        },
                    },
                ],
            });

            let showTimeout;
            function show() {
                showTimeout = setTimeout(() => {
                    // On ignore si l'élément a l'attribut disabled
                    if (tooltip.target.hasAttribute('disabled')) return;

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

            const showEvents = ['mouseenter', 'focus'];
            const hideEvents = ['mouseleave', 'blur'];

            showEvents.forEach((event) => {
                tooltip.target.addEventListener(event, show);
            });

            hideEvents.forEach((event) => {
                tooltip.target.addEventListener(event, hide);
            });
        });
    }
}

export {TooltipsManager};