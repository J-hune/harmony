const STEPS = ['palette', 'layers', 'harmonies'];

const ACTIVE_LABELS = {
   palette: 'Extraction de la palette',
   layers: 'Décomposition en couches',
   harmonies: 'Calcul des harmonies',
};

const nowTag = () => new Date().toLocaleTimeString('fr-FR', { hour12: false });

/**
 * Affiche l'avancement du traitement (3 étapes) et tient un journal détaillé,
 * replié par défaut, pour les messages techniques du serveur.
 */
class StatusManager {
   constructor() {
      this.status = document.getElementById('status');
      this.text = document.getElementById('status-text');
      this.steps = Object.fromEntries(
         STEPS.map((step) => [step, this.status.querySelector(`[data-step="${step}"]`)]),
      );
      this.journal = document.getElementById('journal');
      this.entries = document.getElementById('journal-entries');
      this.toggle = document.getElementById('journal-toggle');

      this.activeStep = null;
      this.startedAt = null;
      this.timer = null;
      this.queuePosition = 0;
      this.offline = false;

      this.toggle.addEventListener('click', () => {
         const open = this.journal.classList.toggle('hidden') === false;
         this.toggle.setAttribute('aria-expanded', String(open));
         if (open) this.journal.scrollTop = this.journal.scrollHeight;
      });
   }

   /** Remet toutes les étapes à zéro et démarre la première. */
   begin() {
      this.queuePosition = 0;
      this.offline = false;
      this.status.removeAttribute('data-state');
      STEPS.forEach((step) => this.steps[step].removeAttribute('data-state'));
      this.startedAt = Date.now();
      this.activate('palette');

      clearInterval(this.timer);
      this.timer = setInterval(() => this.render(), 1000);
   }

   /** Marque une étape comme terminée et démarre la suivante. */
   complete(step) {
      this.steps[step].dataset.state = 'done';
      const next = STEPS[STEPS.indexOf(step) + 1];
      if (next) {
         this.activate(next);
      } else {
         this.finish();
      }
   }

   /** Indique si un traitement est en cours (une étape est active). */
   isBusy() {
      return this.activeStep !== null;
   }

   activate(step) {
      this.activeStep = step;
      this.steps[step].dataset.state = 'active';
      this.render();
   }

   finish() {
      clearInterval(this.timer);
      this.activeStep = null;
      this.setText(
         `Terminé en ${this.elapsed()} s. Choisissez une harmonie pour recolorer l’image.`,
      );
   }

   /** Affiche une erreur sur l'étape en cours et l'ajoute au journal. */
   fail(message) {
      clearInterval(this.timer);
      this.offline = false;
      if (this.activeStep) this.steps[this.activeStep].dataset.state = 'error';
      this.activeStep = null;
      this.status.dataset.state = 'error';
      this.setText(message);
      this.log(message, 'error');
   }

   /** Revient à l'état initial, sans image. */
   idle(message = 'Ajoutez une image pour commencer.') {
      clearInterval(this.timer);
      this.offline = false;
      this.activeStep = null;
      this.status.removeAttribute('data-state');
      STEPS.forEach((step) => this.steps[step].removeAttribute('data-state'));
      this.setText(message);
   }

   /**
    * Position dans la file d'attente du serveur (0 = le calcul démarre).
    * Pendant l'attente, aucune étape n'est allumée : rien n'est encore calculé.
    * @param {number} position
    */
   setQueuePosition(position) {
      this.queuePosition = position;
      const first = this.steps[STEPS[0]];
      if (position > 0) {
         first.removeAttribute('data-state');
      } else if (this.activeStep === STEPS[0]) {
         first.dataset.state = 'active';
         this.startedAt = Date.now(); // le chronomètre démarre avec le calcul
      }
      this.render();
   }

   /**
    * Pas de connexion au serveur pendant le traitement : il reprendra à son retour.
    * @param {boolean} offline
    */
   setOffline(offline) {
      this.offline = offline;
      this.render();
   }

   render() {
      if (!this.activeStep) return;
      if (this.offline) {
         this.setText('En attente de la connexion au serveur, le traitement reprendra tout seul…');
         return;
      }
      if (this.queuePosition > 0) {
         this.setText('En file d’attente');
         return;
      }
      this.setText(`${ACTIVE_LABELS[this.activeStep]}… ${this.elapsed()} s`);
   }

   elapsed() {
      return Math.round((Date.now() - this.startedAt) / 1000);
   }

   setText(message) {
      this.text.textContent = message;
   }

   /**
    * Ajoute une ligne au journal.
    * @param {string} message
    * @param {'info'|'error'} [type='info']
    */
   log(message, type = 'info') {
      const li = document.createElement('li');
      if (type === 'error') li.className = 'is-error';

      const time = document.createElement('time');
      time.textContent = nowTag();
      li.append(time, message);
      this.entries.appendChild(li);

      if (!this.journal.classList.contains('hidden')) {
         this.journal.scrollTop = this.journal.scrollHeight;
      }
   }
}

export { StatusManager };
