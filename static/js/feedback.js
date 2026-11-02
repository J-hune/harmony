// Images de l'étude : l'originale et ses versions harmonisées, hébergées à part
const IMAGES_BASE_URL = 'https://donovann.dev/form/harmony';

// Liste des types d'harmonie proposés (« original » = image non modifiée)
const harmonies = [
   'original',
   'monochromatic',
   'analogous',
   'complementary',
   'triadic',
   'square',
   'triadic',
   'split',
   'double-split',
];

const MAX_LOAD_ATTEMPTS = 3;
// Durée minimale de lecture de l'introduction avant de pouvoir commencer
const INTRO_DELAY_SECONDS = 6;
const INTRO_SEEN_KEY = 'harmony-feedback-intro-seen';

const pair = document.getElementById('pair');
const buttons = [document.getElementById('choice-a'), document.getElementById('choice-b')];
const images = [document.getElementById('img1'), document.getElementById('img2')];
const status = document.getElementById('survey-status');
const survey = document.querySelector('.survey');
const intro = document.getElementById('intro');
const test = document.getElementById('test');
const startButton = document.getElementById('start-survey');

let ids = [];
// Paire actuellement affichée : c'est elle, et elle seule, qui reçoit le vote
let currentRound = null;
let answers = 0;
// Dimensions naturelles des deux images affichées
let naturalSizes = null;

function getRandomElement(arr) {
   return arr[Math.floor(Math.random() * arr.length)];
}

function getTwoDistinctElements(arr) {
   const first = getRandomElement(arr);
   let second = getRandomElement(arr);
   while (second === first) second = getRandomElement(arr);
   return [first, second];
}

function imageUrl(id, harmony) {
   return harmony === 'original'
      ? `${IMAGES_BASE_URL}/${id}/${id}.png`
      : `${IMAGES_BASE_URL}/${id}/harmonies/${id}_${harmony}-harmony_recon.png`;
}

function preload(url) {
   return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Image introuvable : ${url}`));
      img.src = url;
   });
}

function setStatus(message, { error = false, pending = false } = {}) {
   status.textContent = message;
   status.classList.toggle('is-error', error);
   status.classList.toggle('is-pending', pending);
}

/** Espace disponible pour la paire, sous le titre, sans faire défiler la page. */
function availableArea() {
   const style = getComputedStyle(survey);
   const width = survey.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
   const top = test.getBoundingClientRect().top + window.scrollY;
   const gap = parseFloat(getComputedStyle(test).rowGap) || 0;
   const statusHeight = status.offsetHeight || 20;
   const height = window.innerHeight - top - gap - statusHeight - parseFloat(style.paddingBottom);
   return { width, height: Math.max(height, 180) };
}

/**
 * Choisit entre « côte à côte » et « empilées » la disposition qui affiche les
 * images le plus grand, puis fixe leur taille (sans jamais les agrandir).
 */
function layoutPair() {
   if (!naturalSizes || test.classList.contains('hidden')) return;
   const { width, height } = availableArea();
   const gap = parseFloat(getComputedStyle(pair).columnGap) || 0;

   const scaleFor = (boxWidth, boxHeight) =>
      Math.min(...naturalSizes.map(([w, h]) => Math.min(boxWidth / w, boxHeight / h, 1)));
   const sideBySide = scaleFor((width - gap) / 2, height);
   const stacked = scaleFor(width, (height - gap) / 2);
   const scale = Math.max(sideBySide, stacked);

   pair.classList.toggle('is-stacked', stacked > sideBySide);
   images.forEach((img, i) => {
      const [w, h] = naturalSizes[i];
      img.style.width = `${Math.floor(w * scale)}px`;
      img.style.height = `${Math.floor(h * scale)}px`;
   });
}

/** Désactive l'effet de survol jusqu'au prochain mouvement réel de la souris. */
function awaitPointerMove() {
   pair.classList.add('awaiting-pointer');
   window.addEventListener('pointermove', () => pair.classList.remove('awaiting-pointer'), { once: true });
}

let resizeFrame = 0;
window.addEventListener('resize', () => {
   cancelAnimationFrame(resizeFrame);
   resizeFrame = requestAnimationFrame(layoutPair);
});

function setLoading(loading) {
   pair.classList.toggle('is-loading', loading);
   pair.setAttribute('aria-busy', String(loading));
   buttons.forEach((button) => (button.disabled = loading));
}

function answersMessage() {
   if (answers === 0) return '';
   return answers === 1 ? 'Merci, 1 réponse enregistrée.' : `Merci, ${answers} réponses enregistrées.`;
}

/**
 * Charge une nouvelle paire et ne l'affiche (et ne la rend votable)
 * qu'une fois les deux images prêtes.
 */
async function loadNewImages(attempt = 1) {
   setLoading(true);

   const id = getRandomElement(ids);
   const [harmony1, harmony2] = getTwoDistinctElements(harmonies);
   const urls = [imageUrl(id, harmony1), imageUrl(id, harmony2)];

   try {
      const loaded = await Promise.all(urls.map(preload));
      naturalSizes = loaded.map((img) => [img.naturalWidth, img.naturalHeight]);
      images[0].src = urls[0];
      images[1].src = urls[1];
      pair.classList.remove('is-empty');
      layoutPair();
      awaitPointerMove();

      currentRound = { id, harmony1, harmony2 };
      setLoading(false);
      if (!status.classList.contains('is-error')) setStatus(answersMessage());
   } catch (error) {
      console.error(error);
      if (attempt < MAX_LOAD_ATTEMPTS) return loadNewImages(attempt + 1);
      setStatus('Les images n’ont pas pu être chargées. Rechargez la page pour réessayer.', { error: true });
   }
}

async function sendFeedback(round, harmonyChosen) {
   try {
      const response = await fetch('/form/feedback', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
            id: round.id,
            harmonyChosen,
            harmonyOption1: round.harmony1,
            harmonyOption2: round.harmony2,
         }),
      });
      if (!response.ok) throw new Error(response.statusText);
      answers++;
      setStatus(answersMessage());
   } catch (error) {
      console.error("Erreur lors de l'envoi du feedback :", error);
      setStatus('Votre dernier choix n’a pas pu être enregistré. Vous pouvez continuer.', { error: true });
   }
}

buttons.forEach((button, index) => {
   button.addEventListener('click', () => {
      if (!currentRound || pair.classList.contains('is-loading')) return;

      const round = currentRound;
      currentRound = null; // un seul vote par paire
      sendFeedback(round, index === 0 ? round.harmony1 : round.harmony2);
      setStatus(answersMessage());
      loadNewImages();
   });
});

/* ---------- Introduction ---------- */

function startSurvey() {
   intro.classList.add('hidden');
   test.classList.remove('hidden');
   sessionStorage.setItem(INTRO_SEEN_KEY, '1');
   layoutPair(); // la première paire a pu se charger pendant la lecture
   awaitPointerMove();
   // Pas de focus automatique : il assombrirait une des deux images et biaiserait le choix
}

startButton.addEventListener('click', startSurvey);

if (sessionStorage.getItem(INTRO_SEEN_KEY)) {
   // Déjà lue pendant cette session (rechargement de la page) : on passe directement au test
   startSurvey();
} else {
   let remaining = INTRO_DELAY_SECONDS;
   const countdown = setInterval(() => {
      remaining--;
      if (remaining > 0) {
         startButton.textContent = `Commencer dans ${remaining}\u00a0s`;
         return;
      }
      clearInterval(countdown);
      startButton.textContent = 'Commencer l’évaluation';
      startButton.disabled = false;
   }, 1000);
}

// On charge les IDs des images depuis le serveur (dès l'introduction, pour ne pas attendre ensuite)
fetch('/img_ids')
   .then((response) => response.json())
   .then((data) => {
      ids = data;
      loadNewImages();
   })
   .catch((error) => {
      console.error('Erreur lors du chargement des IDs:', error);
      setStatus('La liste des images n’a pas pu être chargée. Rechargez la page pour réessayer.', { error: true });
   });
