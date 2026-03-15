import asyncio
import base64
import csv
import datetime
import json
import logging
import multiprocessing
import os
import queue
import secrets
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np
import socketio
import uvicorn
from flask import Flask, jsonify, render_template, request, session

from image_decomposition import extract_rgbxy_weights
from palette_harmonization import harmonize_palette
from palette_simplification import simplify_convex_palette


def _str_to_bool(value, default=False):
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _parse_cors_origins(value):
    if value is None or value.strip() == "":
        return ["http://127.0.0.1:5000", "http://localhost:5000"]
    if value.strip() == "*":
        return "*"
    return [origin.strip() for origin in value.split(",") if origin.strip()]


def _decode_image(img_data):
    if not img_data:
        raise ValueError("Aucune donnée image fournie")

    encoded = img_data
    if "," in img_data:
        _, encoded = img_data.split(",", 1)

    try:
        img_bytes = base64.b64decode(encoded)
    except Exception as exc:
        raise ValueError("Erreur de décodage Base64") from exc

    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Données image invalides")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray_3ch = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    if np.array_equal(img, gray_3ch):
        raise ValueError("L'image doit être en couleur")

    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB) / 255.0


def run_socket_server(socket_port, socket_id):
    sio = socketio.AsyncServer(
        async_mode="asgi",
        cors_allowed_origins=CORS_ALLOWED_ORIGINS,
        max_http_buffer_size=MAX_HTTP_BUFFER_SIZE,
        ping_timeout=SOCKET_PING_TIMEOUT,
        ping_interval=SOCKET_PING_INTERVAL,
        logger=DEBUG,
        engineio_logger=DEBUG,
    )
    socketio_path = f"{socket_id}/socket.io" if REVERSE_PROXY else "socket.io"
    asgi_app = socketio.ASGIApp(sio, socketio_path=socketio_path)
    executor = ThreadPoolExecutor(max_workers=SOCKET_WORKERS)

    @sio.event
    async def connect(sid, environ, auth):
        del environ, auth
        await sio.emit("server_response", {"data": f"Connexion au moteur de calcul établie (port {socket_port})."}, to=sid)

    @sio.event
    async def disconnect(sid):
        logging.info("[Socket %s] Client déconnecté (%s)", socket_port, sid)

    @sio.event
    async def upload_image(sid, data):
        await sio.emit("thinking", {"thinking": True}, to=sid)
        payload = data if isinstance(data, dict) else {}
        img_data = payload.get("image_data")

        if not img_data:
            await sio.emit("error", {"message": "Aucune image reçue. Merci de réessayer l'envoi."}, to=sid)
            await sio.emit("thinking", {"thinking": False}, to=sid)
            return

        loop = asyncio.get_running_loop()
        event_queue = queue.Queue()
        done_marker = object()

        def blocking_pipeline():
            def emitter(event, event_payload):
                event_queue.put((event, event_payload))

            try:
                emitter("server_log", {"data": "Analyse de l'image démarrée. Extraction des couleurs dominantes..."})
                pixels = _decode_image(img_data)
                palette = simplify_convex_palette(pixels, 6, emitter=emitter)
                if palette is None:
                    return

                vertices = palette["vertices"]
                faces = palette["faces"]
                emitter(
                    "convex_hull",
                    {"type": "simplified", "vertices": vertices.tolist(), "faces": faces.tolist()},
                )
                emitter("server_log", {"data": "Palette simplifiée validée. Calcul des couches RGBXY en cours..."})
                extract_rgbxy_weights(vertices, pixels, emitter=emitter)
                emitter("server_log", {"data": "Traitement terminé. Les couches sont prêtes."})
            except ValueError as exc:
                emitter("server_response", {"error": str(exc), "reset": True})
            except Exception:
                logging.exception("Erreur lors du traitement upload_image")
                emitter("server_response", {"error": "Une erreur interne a interrompu le traitement de l'image.", "reset": True})
            finally:
                event_queue.put(done_marker)

        worker_future = loop.run_in_executor(executor, blocking_pipeline)

        last_heartbeat = loop.time()
        while True:
            item = await loop.run_in_executor(None, _queue_get_with_timeout, event_queue, 1.0)
            if item is done_marker:
                break

            if item is None:
                now = loop.time()
                if now - last_heartbeat >= SOCKET_PROGRESS_HEARTBEAT_SECONDS:
                    await sio.emit("server_log", {"data": "Traitement en cours... l'opération prend plus de temps que d'habitude, merci de patienter."}, to=sid)
                    last_heartbeat = now
                continue

            event_name, event_payload = item
            await sio.emit(event_name, event_payload, to=sid)

        await worker_future
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
            loop = asyncio.get_running_loop()
            harmonized = await loop.run_in_executor(executor, harmonize_palette, palette)
            await sio.emit("harmonized", harmonized, to=sid)
        except Exception:
            logging.exception("Erreur lors de l'harmonisation")
            await sio.emit("error", {"message": "Une erreur interne est survenue pendant l'harmonisation."}, to=sid)
        finally:
            await sio.emit("thinking", {"thinking": False}, to=sid)

    log_level = "info" if DEBUG else "warning"
    logging.info("Démarrage du serveur socket ASGI sur le port %s", socket_port)
    uvicorn.run(asgi_app, host=HOST, port=socket_port, log_level=log_level)


load_balancer_port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.getenv("LOAD_BALANCER_PORT", "5000"))
socket_number = int(sys.argv[2]) if len(sys.argv) > 2 else int(os.getenv("SOCKET_NUMBER", "2"))
socket_ports = [load_balancer_port + i for i in range(1, socket_number + 1)]
lb_counter = 0

REVERSE_PROXY = _str_to_bool(os.getenv("REVERSE_PROXY"), default=False)
DEBUG = _str_to_bool(os.getenv("DEBUG"), default=False)
HOST = os.getenv("HOST", "127.0.0.1")
APP_SECRET_KEY = os.getenv("APP_SECRET_KEY", secrets.token_hex(32))
MAX_HTTP_BUFFER_SIZE = int(os.getenv("MAX_HTTP_BUFFER_SIZE", str(6 * 1024 * 1024)))
CORS_ALLOWED_ORIGINS = _parse_cors_origins(os.getenv("CORS_ALLOWED_ORIGINS"))
SOCKET_WORKERS = max(1, int(os.getenv("SOCKET_WORKERS", str(min(4, os.cpu_count() or 2)))))
SOCKET_PING_TIMEOUT = int(os.getenv("SOCKET_PING_TIMEOUT", "120"))
SOCKET_PING_INTERVAL = int(os.getenv("SOCKET_PING_INTERVAL", "25"))
SOCKET_PROGRESS_HEARTBEAT_SECONDS = int(os.getenv("SOCKET_PROGRESS_HEARTBEAT_SECONDS", "15"))


def _queue_get_with_timeout(q, timeout_seconds):
    try:
        return q.get(timeout=timeout_seconds)
    except queue.Empty:
        return None


def get_next_socket_id():
    global lb_counter
    socket_port = socket_ports[lb_counter % len(socket_ports)]
    socket_id = socket_port - load_balancer_port
    lb_counter += 1
    return [socket_id, socket_port]


def run_web_server():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = APP_SECRET_KEY

    if not DEBUG:
        logging.getLogger("werkzeug").setLevel(logging.ERROR)

    with open("./ids.json", "r", encoding="utf-8") as ids_file:
        img_ids = json.load(ids_file)

    @app.route("/")
    def index():
        return render_template("index.html")

    @app.route("/app")
    def harmonize_page():
        return render_template("app.html")

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

    @app.route("/get_socket_id")
    def get_socket_id():
        socket_id, socket_port = get_next_socket_id()
        if REVERSE_PROXY:
            return jsonify({"socket_id": socket_id})
        return jsonify({"socket_port": socket_port})

    logging.info("Démarrage du serveur web sur le port %s", load_balancer_port)
    app.run(host=HOST, port=load_balancer_port, debug=DEBUG)


if __name__ == "__main__":
    processes = []
    logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s %(message)s")

    for i, port in enumerate(socket_ports):
        process = multiprocessing.Process(target=run_socket_server, args=(port, i + 1))
        process.start()
        processes.append(process)

    run_web_server()

    for process in processes:
        process.join()
