"""
Serveur Harmony : une seule application, sur un seul port.

- Flask sert les pages, les fichiers statiques et l'API du formulaire d'évaluation.
- Socket.IO (même port, chemin /socket.io/) reçoit les images et renvoie l'avancement.
- Les calculs tournent dans un pool de processus borné ; au-delà, les demandes
  attendent dans une file (position et attente estimée envoyées au navigateur).
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
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool

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
# Traitement des images (Socket.IO + file d'attente + pool de calcul)
# --------------------------------------------------------------------------

def _new_compute_pool(context):
    """Pool de processus de calcul ; chaque processus est recyclé régulièrement pour rendre la mémoire."""
    return ProcessPoolExecutor(max_workers=MAX_CONCURRENT_JOBS, mp_context=context, max_tasks_per_child=10)


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
    pool = _new_compute_pool(context)
    connected = set()
    recent_durations = deque(maxlen=10)  # durée des derniers calculs, pour estimer l'attente

    def estimated_wait(position):
        """Attente estimée en secondes, ou None tant qu'aucun calcul n'a servi de référence."""
        if SIMULATED_QUEUE_AHEAD:
            return position * SIMULATED_JOB_SECONDS
        if not recent_durations:
            return None
        return round(position * sum(recent_durations) / len(recent_durations))

    async def send_queue_position(sid, position):
        await sio.emit("queue", {"position": position, "eta": estimated_wait(position) if position else None}, to=sid)

    jobs = JobQueue(MAX_CONCURRENT_JOBS, MAX_QUEUE_LENGTH, on_position=send_queue_position)

    async def reject(sid, message):
        """Refuse un envoi : message affiché sous la zone de dépôt, interface réinitialisée."""
        await sio.emit("server_response", {"error": message, "reset": True}, to=sid)
        await sio.emit("thinking", {"thinking": False}, to=sid)

    @sio.event
    async def connect(sid, environ, auth):
        del environ, auth
        connected.add(sid)
        await sio.emit("server_response", {"data": "Connexion au moteur de calcul établie."}, to=sid)

    @sio.event
    async def disconnect(sid):
        connected.discard(sid)
        jobs.cancel(sid)
        logging.info("Client déconnecté (%s)", sid)

    @sio.event
    async def upload_image(sid, data):
        nonlocal pool
        await sio.emit("thinking", {"thinking": True}, to=sid)
        payload = data if isinstance(data, dict) else {}
        img_data = payload.get("image_data")

        if not img_data or not isinstance(img_data, str):
            await reject(sid, "Aucune image reçue. Merci de réessayer l'envoi.")
            return

        # Refus immédiat (avant la file) des fichiers invalides ou trop grands
        error = await asyncio.to_thread(_check_image, img_data)
        if error:
            await reject(sid, error)
            return

        # Mode développement : simule des images en attente devant celle-ci (aucun calcul lancé).
        for position in range(SIMULATED_QUEUE_AHEAD, 0, -1):
            await send_queue_position(sid, position)
            await asyncio.sleep(SIMULATED_JOB_SECONDS)
            if sid not in connected:
                return

        try:
            await jobs.acquire(sid)
        except QueueFullError:
            await reject(sid, "Le serveur est très demandé en ce moment. Réessayez dans quelques minutes.")
            return
        except asyncio.CancelledError:
            return  # déconnecté pendant l'attente

        loop = asyncio.get_running_loop()
        try:
            if sid not in connected:
                return  # parti juste au moment où son tour arrivait
            await send_queue_position(sid, 0)
            logging.info("Calcul démarré (%s), %d en attente", sid, jobs.waiting)
            started_at = time.monotonic()

            events = manager.Queue()
            job = loop.run_in_executor(pool, run_pipeline, img_data, MAX_IMAGE_PIXELS, events)
            last_heartbeat = loop.time()
            while True:
                item = await loop.run_in_executor(None, _queue_get_with_timeout, events, 1.0)
                if item is None:
                    if job.done():
                        break  # le processus de calcul s'est arrêté sans marqueur de fin
                    if loop.time() - last_heartbeat >= SOCKET_PROGRESS_HEARTBEAT_SECONDS:
                        await sio.emit("server_log", {"data": "Traitement en cours... l'opération prend plus de temps que d'habitude, merci de patienter."}, to=sid)
                        last_heartbeat = loop.time()
                    continue
                event_name, event_payload = item
                if event_name == DONE:
                    break
                await sio.emit(event_name, event_payload, to=sid)
            await job
            recent_durations.append(time.monotonic() - started_at)
        except BrokenProcessPool:
            # Un processus de calcul a été tué (manque de mémoire par exemple) : on repart d'un pool neuf.
            logging.exception("Processus de calcul interrompu, recréation du pool")
            pool = _new_compute_pool(context)
            await sio.emit("server_response", {"error": "Le calcul a été interrompu par le serveur. Réessayez dans quelques instants.", "reset": True}, to=sid)
        finally:
            jobs.release()
            await sio.emit("thinking", {"thinking": False}, to=sid)

    @sio.event
    async def harmonize(sid, data):
        await sio.emit("thinking", {"thinking": True}, to=sid)
        payload = data if isinstance(data, dict) else {}
        palette = payload.get("palette")

        if not palette:
            await sio.emit("error", {"message": "Aucune palette n'a été reçue pour l'harmonisation."}, to=sid)
            await sio.emit("thinking", {"thinking": False}, to=sid)
            return

        try:
            # Calcul léger (quelques couleurs) : un thread suffit, pas besoin de la file
            harmonized = await asyncio.to_thread(harmonize_palette, palette)
            await sio.emit("harmonized", harmonized, to=sid)
        except Exception:
            logging.exception("Erreur lors de l'harmonisation")
            await sio.emit("error", {"message": "Une erreur interne est survenue pendant l'harmonisation."}, to=sid)
        finally:
            await sio.emit("thinking", {"thinking": False}, to=sid)

    return sio


def main():
    logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s %(message)s")

    # Processus de calcul démarrés depuis un serveur dédié (numpy/scipy préchargés une fois)
    context = multiprocessing.get_context("forkserver")
    context.set_forkserver_preload(["pipeline"])

    sio = create_socket_server(context)
    app = socketio.ASGIApp(sio, other_asgi_app=WSGIMiddleware(create_web_app()))

    logging.info("Démarrage du serveur sur le port %s (%d calcul(s) simultané(s), file de %d)", PORT, MAX_CONCURRENT_JOBS, MAX_QUEUE_LENGTH)
    uvicorn.run(app, host=HOST, port=PORT, log_level="info" if DEBUG else "warning")


if __name__ == "__main__":
    main()
