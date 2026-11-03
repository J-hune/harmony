"""
Serveur Harmony : une seule application, sur un seul port.

- Flask sert les pages, les fichiers statiques et l'API du formulaire d'évaluation.
- Socket.IO (même port, chemin /socket.io/) reçoit les images et renvoie l'avancement.
- Chaque calcul tourne dans son propre processus, en nombre borné ; au-delà, les
  demandes attendent dans une file (position et attente estimée envoyées au navigateur).
  Un calcul est arrêté dès que son image est remplacée ou que le client se déconnecte.
"""
import asyncio
import base64
import binascii
import csv
import datetime
import io
import json
import logging
import multiprocessing
import os
import queue
import secrets
import time
import uuid
import warnings
from collections import deque
from dataclasses import dataclass

import socketio
import uvicorn
from a2wsgi import WSGIMiddleware
from flask import Flask, jsonify, render_template, request, session
from PIL import Image

from job_queue import JobQueue, QueueFullError
from palette_harmonization import harmonize_palette
from pipeline import DONE, run_pipeline, too_large_message


def _str_to_bool(value, default=False):
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _parse_cors_origins(value):
    """Origines autorisées pour Socket.IO ; par défaut, seulement l'adresse du site lui-même."""
    if value is None or value.strip() == "":
        return None
    if value.strip() == "*":
        return "*"
    return [origin.strip() for origin in value.split(",") if origin.strip()]


# Port unique : pages, fichiers statiques et WebSocket
PORT = int(os.getenv("PORT", "5000"))
HOST = os.getenv("HOST", "127.0.0.1")
DEBUG = _str_to_bool(os.getenv("DEBUG"), default=False)
APP_SECRET_KEY = os.getenv("APP_SECRET_KEY", secrets.token_hex(32))
MAX_HTTP_BUFFER_SIZE = int(os.getenv("MAX_HTTP_BUFFER_SIZE", str(6 * 1024 * 1024)))
CORS_ALLOWED_ORIGINS = _parse_cors_origins(os.getenv("CORS_ALLOWED_ORIGINS"))
SOCKET_PING_TIMEOUT = int(os.getenv("SOCKET_PING_TIMEOUT", "120"))
SOCKET_PING_INTERVAL = int(os.getenv("SOCKET_PING_INTERVAL", "25"))
SOCKET_PROGRESS_HEARTBEAT_SECONDS = int(os.getenv("SOCKET_PROGRESS_HEARTBEAT_SECONDS", "15"))

# Calculs simultanés, longueur de la file d'attente et taille maximale des images
# (la mémoire d'un calcul croît avec le nombre de pixels : environ 1,4 Go à 2 Mpx).
MAX_CONCURRENT_JOBS = max(1, int(os.getenv("MAX_CONCURRENT_JOBS", "1")))
MAX_QUEUE_LENGTH = max(0, int(os.getenv("MAX_QUEUE_LENGTH", "5")))
MAX_IMAGE_PIXELS = max(1, int(os.getenv("MAX_IMAGE_PIXELS", "2000000")))

# Développement uniquement : fait attendre chaque envoi derrière N images fictives
# (de SIMULATED_JOB_SECONDS chacune) pour tester l'interface de la file d'attente.
SIMULATED_QUEUE_AHEAD = max(0, int(os.getenv("DEV_SIMULATED_QUEUE", "0")))
SIMULATED_JOB_SECONDS = max(1, int(os.getenv("DEV_SIMULATED_JOB_SECONDS", "20")))


def _queue_get_with_timeout(q, timeout_seconds):
    try:
        return q.get(timeout=timeout_seconds)
    except queue.Empty:
        return None


def _check_image(img_data):
    """
    Vérifie l'image avant de la mettre en file, en ne lisant que son en-tête
    (rien n'est décompressé). Retourne un message d'erreur, ou None si elle est acceptée.
    """
    encoded = img_data.split(",", 1)[1] if "," in img_data else img_data
    try:
        # Taille lue dans l'en-tête seulement ; l'avertissement « bombe » de Pillow est
        # inutile ici puisque l'image trop grande est refusée juste après.
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(base64.b64decode(encoded))) as image:
                width, height = image.size
    except Image.DecompressionBombError:
        return too_large_message(None, None, MAX_IMAGE_PIXELS)
    except (binascii.Error, ValueError, OSError):
        return "Ce fichier n'est pas une image valide. Choisissez une image JPG, PNG ou WebP."
    if width * height > MAX_IMAGE_PIXELS:
        return too_large_message(width, height, MAX_IMAGE_PIXELS)
    return None


# --------------------------------------------------------------------------
# Pages et API (Flask)
# --------------------------------------------------------------------------

def create_web_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = APP_SECRET_KEY

    with open("./ids.json", "r", encoding="utf-8") as ids_file:
        img_ids = json.load(ids_file)

    @app.route("/")
    def index():
        return render_template("index.html")

    @app.route("/app")
    def harmonize_page():
        return render_template("app.html", max_image_pixels=MAX_IMAGE_PIXELS)

    @app.route("/feedback")
    def form():
        return render_template("feedback.html")

    @app.route("/healthz")
    def healthz():
        return jsonify({"status": "ok"})

    @app.route("/img_ids")
    def get_img_ids():
        return jsonify(img_ids)

    @app.route("/form/feedback", methods=["POST"])
    def form_feedback():
        data = request.get_json(silent=True) or {}
        img_id = data.get("id")
        harmony1 = data.get("harmonyOption1")
        harmony2 = data.get("harmonyOption2")
        choice = data.get("harmonyChosen")

        if not img_id or not harmony1 or not harmony2 or not choice:
            return jsonify({"success": False, "message": "Données manquantes"}), 400

        if "user_id" not in session:
            session["user_id"] = str(uuid.uuid4())

        timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

        with open("feedback.csv", "a", newline="", encoding="utf-8") as feedback_file:
            writer = csv.writer(feedback_file)
            writer.writerow([timestamp, session["user_id"], img_id, harmony1, harmony2, choice])

        return jsonify({"success": True}), 200

    @app.errorhandler(404)
    def page_not_found(_):
        return render_template("index.html"), 404

    return app


# --------------------------------------------------------------------------
# Traitement des images (Socket.IO + file d'attente + un processus par calcul)
# --------------------------------------------------------------------------
#
# Politique : un seul traitement par connexion, et rien ne survit à la connexion.
# - Un nouvel envoi interrompt le traitement en cours de la même connexion.
# - Une déconnexion (page rechargée ou fermée, réseau coupé) l'annule aussi :
#   le calcul est arrêté et sa place rendue à la file. Après une coupure réseau,
#   le navigateur renvoie lui-même l'image une fois reconnecté.
# Chaque événement porte l'identifiant `job` donné par le navigateur à l'envoi,
# qui ignore ainsi ceux d'une image remplacée entre-temps.


@dataclass(eq=False)
class ImageJob:
    """Traitement d'une image pour une connexion (comparé par identité : clé de la file)."""
    sid: str
    id: str | None
    task: asyncio.Task


def _job_id(payload):
    """Identifiant de traitement envoyé par le navigateur (None s'il est absent ou invalide)."""
    job_id = payload.get("job")
    return job_id if isinstance(job_id, str) and 0 < len(job_id) <= 64 else None


def _stop_process(process):
    """Arrête un processus de calcul (sans effet s'il a déjà fini) et attend sa fin."""
    if process.is_alive():
        process.kill()  # rien à sauvegarder : arrêt immédiat, quels que soient ses signaux
    process.join()


def create_socket_server(context):
    sio = socketio.AsyncServer(
        async_mode="asgi",
        cors_allowed_origins=CORS_ALLOWED_ORIGINS,
        max_http_buffer_size=MAX_HTTP_BUFFER_SIZE,
        ping_timeout=SOCKET_PING_TIMEOUT,
        ping_interval=SOCKET_PING_INTERVAL,
        logger=DEBUG,
        engineio_logger=DEBUG,
    )

    manager = context.Manager()
    connected = set()
    active = {}  # sid -> ImageJob en cours (au plus un par connexion)
    recent_durations = deque(maxlen=10)  # durée des derniers calculs, pour estimer l'attente

    def estimated_wait(position):
        """Attente estimée en secondes, ou None tant qu'aucun calcul n'a servi de référence."""
        if SIMULATED_QUEUE_AHEAD:
            return position * SIMULATED_JOB_SECONDS
        if not recent_durations:
            return None
        return round(position * sum(recent_durations) / len(recent_durations))

    async def emit_job(job, event, payload):
        await sio.emit(event, {**payload, "job": job.id}, to=job.sid)

    async def send_queue_position(job, position):
        await emit_job(job, "queue", {"position": position, "eta": estimated_wait(position) if position else None})

    jobs = JobQueue(MAX_CONCURRENT_JOBS, MAX_QUEUE_LENGTH, on_position=send_queue_position)

    async def reject(job, message):
        """Refuse un envoi : message affiché sous la zone de dépôt, interface réinitialisée."""
        await emit_job(job, "server_response", {"error": message, "reset": True})
        await emit_job(job, "thinking", {"thinking": False})

    @sio.event
    async def connect(sid, environ, auth):
        del environ, auth
        connected.add(sid)
        await sio.emit("server_response", {"data": "Connexion au moteur de calcul établie."}, to=sid)

    @sio.event
    async def disconnect(sid, *_):
        connected.discard(sid)
        job = active.pop(sid, None)
        if job is not None:
            job.task.cancel()
            logging.info("Client déconnecté (%s), traitement annulé", sid)
        else:
            logging.info("Client déconnecté (%s)", sid)

    @sio.event
    async def upload_image(sid, data):
        if sid not in connected:
            return
        payload = data if isinstance(data, dict) else {}
        job = ImageJob(sid, _job_id(payload), asyncio.current_task())
        previous = active.get(sid)
        active[sid] = job
        try:
            if previous is not None:
                # Une seule image par connexion : la précédente est abandonnée.
                previous.task.cancel()
                await asyncio.wait({previous.task})
                logging.info("Traitement remplacé par une nouvelle image (%s)", sid)
            await process_image(job, payload.get("image_data"))
        except asyncio.CancelledError:
            pass  # image remplacée ou client déconnecté : le calcul a été arrêté
        except Exception:
            logging.exception("Erreur lors du traitement de l'image (%s)", sid)
            await reject(job, "Une erreur interne a interrompu le traitement de l'image.")
        finally:
            if active.get(sid) is job:
                del active[sid]

    async def process_image(job, img_data):
        await emit_job(job, "thinking", {"thinking": True})

        if not img_data or not isinstance(img_data, str):
            await reject(job, "Aucune image reçue. Merci de réessayer l'envoi.")
            return

        # Refus immédiat (avant la file) des fichiers invalides ou trop grands
        error = await asyncio.to_thread(_check_image, img_data)
        if error:
            await reject(job, error)
            return

        # Mode développement : simule des images en attente devant celle-ci (aucun calcul lancé).
        for position in range(SIMULATED_QUEUE_AHEAD, 0, -1):
            await send_queue_position(job, position)
            await asyncio.sleep(SIMULATED_JOB_SECONDS)

        try:
            await jobs.acquire(job)
        except QueueFullError:
            await reject(job, "Le serveur est très demandé en ce moment. Réessayez dans quelques minutes.")
            return

        try:
            await send_queue_position(job, 0)
            logging.info("Calcul démarré (%s), %d en attente", job.sid, jobs.waiting)
            await run_computation(job, img_data)
        finally:
            jobs.release()
        await emit_job(job, "thinking", {"thinking": False})

    async def run_computation(job, img_data):
        """Lance le calcul dans un processus dédié et relaie ses événements au navigateur."""
        loop = asyncio.get_running_loop()
        started_at = time.monotonic()
        events = manager.Queue()
        process = context.Process(target=run_pipeline, args=(img_data, MAX_IMAGE_PIXELS, events), daemon=True)
        process.start()
        try:
            last_heartbeat = loop.time()
            while True:
                item = await asyncio.to_thread(_queue_get_with_timeout, events, 1.0)
                if item is None:
                    if not process.is_alive():
                        break  # le processus s'est arrêté sans marqueur de fin
                    if loop.time() - last_heartbeat >= SOCKET_PROGRESS_HEARTBEAT_SECONDS:
                        await emit_job(job, "server_log", {"data": "Traitement en cours... l'opération prend plus de temps que d'habitude, merci de patienter."})
                        last_heartbeat = loop.time()
                    continue
                event_name, event_payload = item
                if event_name == DONE:
                    recent_durations.append(time.monotonic() - started_at)
                    return
                await emit_job(job, event_name, event_payload)
        finally:
            # Aussi en cas d'annulation : le calcul est arrêté avant de rendre sa place.
            await asyncio.shield(asyncio.to_thread(_stop_process, process))

        # Processus tué en cours de route (manque de mémoire par exemple)
        logging.error("Processus de calcul interrompu (%s, code %s)", job.sid, process.exitcode)
        await emit_job(job, "server_response", {"error": "Le calcul a été interrompu par le serveur. Réessayez dans quelques instants.", "reset": True})

    @sio.event
    async def harmonize(sid, data):
        payload = data if isinstance(data, dict) else {}
        job = ImageJob(sid, _job_id(payload), asyncio.current_task())
        palette = payload.get("palette")
        await emit_job(job, "thinking", {"thinking": True})

        if not palette:
            await emit_job(job, "error", {"message": "Aucune palette n'a été reçue pour l'harmonisation."})
            await emit_job(job, "thinking", {"thinking": False})
            return

        try:
            # Calcul léger (quelques couleurs) : un thread suffit, pas besoin de la file
            harmonized = await asyncio.to_thread(harmonize_palette, palette)
            await emit_job(job, "harmonized", {"harmonies": harmonized})
        except Exception:
            logging.exception("Erreur lors de l'harmonisation")
            await emit_job(job, "error", {"message": "Une erreur interne est survenue pendant l'harmonisation."})
        finally:
            await emit_job(job, "thinking", {"thinking": False})

    return sio


def main():
    logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s %(message)s")

    # Processus de calcul démarrés depuis un serveur dédié (numpy/scipy préchargés une fois) :
    # un processus neuf par calcul, qui rend toute sa mémoire en se terminant.
    context = multiprocessing.get_context("forkserver")
    context.set_forkserver_preload(["pipeline"])

    sio = create_socket_server(context)
    app = socketio.ASGIApp(sio, other_asgi_app=WSGIMiddleware(create_web_app()))

    logging.info("Démarrage du serveur sur le port %s (%d calcul(s) simultané(s), file de %d)", PORT, MAX_CONCURRENT_JOBS, MAX_QUEUE_LENGTH)
    uvicorn.run(app, host=HOST, port=PORT, log_level="info" if DEBUG else "warning")


if __name__ == "__main__":
    main()
