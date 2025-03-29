// On charge les IDs des images depuis le serveur
let ids = [];
fetch("/img_ids")
    .then(response => response.json())
    .then(data => {
        ids = data;
        loadNewImages();
    })
    .catch(error => console.error('Erreur lors du chargement des IDs:', error));

// Liste des types d'harmonie disponibles
const harmonies = [
    "original",
    "monochromatic",
    "analogous",
    "complementary",
    "triadic",
    "square",
    "triadic",
    "split",
    "double-split"
];

// Fonction qui retourne un élément aléatoire dans un tableau
function getRandomElement(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// Fonction qui retourne deux éléments distincts dans un tableau
function getTwoDistinctElements(arr) {
    let first = getRandomElement(arr);
    let second = getRandomElement(arr);
    while (second === first) {
        second = getRandomElement(arr);
    }
    return [first, second];
}

// Objet pour stocker les informations de la comparaison en cours
let currentRound = {};

// Charge une nouvelle paire d'images
function loadNewImages() {
    const id = getRandomElement(ids);
    const [harmony1, harmony2] = getTwoDistinctElements(harmonies);

    // Enregistrement du round courant
    currentRound = {id, harmony1, harmony2};

    // Construction des URLs pour les images harmonisées
    const url1 = harmony1 === "original" ?
        `https://jhune.dev/form/harmony/${id}/${id}.png` :
        `https://jhune.dev/form/harmony/${id}/harmonies/${id}_${harmony1}-harmony_recon.png`;
    const url2 = harmony2 === "original" ?
        `https://jhune.dev/form/harmony/${id}/${id}.png` :
        `https://jhune.dev/form/harmony/${id}/harmonies/${id}_${harmony2}-harmony_recon.png`;

    // Création des objets Image pour préchargement
    const img1Preload = new Image();
    const img2Preload = new Image();

    let imagesLoaded = 0;

    function onImageLoad() {
        imagesLoaded++;
        if (imagesLoaded === 2) {
            // Les deux images sont chargées, on les affiche
            document.getElementById('img1').src = url1;
            document.getElementById('img2').src = url2;

            if (img2Preload.naturalWidth / img2Preload.naturalHeight >= 1.5) {
                document.getElementById('image-container').classList.add("column");
            } else {
                document.getElementById('image-container').classList.remove("column");
            }
        }
    }

    // Assignation des événements de chargement
    img1Preload.onload = onImageLoad;
    img2Preload.onload = onImageLoad;

    // Déclenchement du chargement des images
    img1Preload.src = url1;
    img2Preload.src = url2;
}

let inEvents = ["mouseover"];
inEvents.forEach(event => {
    document.getElementById('img1').addEventListener(event, function () {
        document.getElementById('img2').classList.add("dimmed");
    });

    document.getElementById('img2').addEventListener(event, function () {
        document.getElementById('img1').classList.add("dimmed");
    });
})

let outEvents = ["mouseout"];
outEvents.forEach(event => {
    document.getElementById('img1').addEventListener(event, function () {
        document.getElementById('img2').classList.remove("dimmed");
    });

    document.getElementById('img2').addEventListener(event, function () {
        document.getElementById('img1').classList.remove("dimmed");
    });
})

// Gestion des clics sur les images
document.getElementById('img1').addEventListener('click', function () {
    fetch("/form/feedback", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            id: currentRound.id,
            harmonyChosen: currentRound.harmony1,
            harmonyOption1: currentRound.harmony1,
            harmonyOption2: currentRound.harmony2
        })
    }).then(r => {
        if (!r.ok) {
            console.error("Erreur lors de l'envoi du feedback :", r.statusText);
        }
    })

    document.getElementById('img1').classList.remove("dimmed");
    document.getElementById('img2').classList.remove("dimmed");
    loadNewImages();
});

document.getElementById('img2').addEventListener('click', function () {
    fetch("/form/feedback", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            id: currentRound.id,
            harmonyChosen: currentRound.harmony2,
            harmonyOption1: currentRound.harmony1,
            harmonyOption2: currentRound.harmony2
        })
    }).then(r => {
        if (!r.ok) {
            console.error("Erreur lors de l'envoi du feedback :", r.statusText);
        }
    })

    document.getElementById('img1').classList.remove("dimmed");
    document.getElementById('img2').classList.remove("dimmed");
    loadNewImages();
});