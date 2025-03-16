import {createPopper} from "popper.js"

class TooltipsManager {
    constructor() {
        this.tooltips = [{
            target: document.getElementById('harmonize'),
            element: null,
            text: 'Harmoniser les couleurs',
            instance: null,
            offset: [0, 8],
            placement: 'left',
            delay: 300
        }, {
            target: document.getElementById('download-palettes'),
            element: null,
            text: 'Télécharger les palettes',
            instance: null,
            offset: [0, 8],
            placement: 'right',
            delay: 300
        }, {
            target: document.getElementById('download-layers'),
            element: null,
            text: 'Télécharger les layers',
            instance: null,
            offset: [0, 8],
            placement: 'right',
            delay: 300
        }, {
            target: document.getElementById('rollback-palette'),
            element: null,
            text: 'Réinitialiser la palette',
            instance: null,
            offset: [0, 8],
            placement: 'bottom-start',
            delay: 200
        }];
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