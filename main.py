import base64
import csv
import datetime
import json
import logging
import multiprocessing
import os
import secrets
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np
from flask import Flask, jsonify, render_template, request, session
from flask_socketio import SocketIO, emit

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


def _is_client_connected(socketio, sid, namespace="/"):
    try:
        return bool(socketio.server.manager.is_connected(sid, namespace))
    except Exception:
        pass

    try:
        rooms_by_namespace = socketio.server.manager.rooms.get(namespace, {})
        default_room = rooms_by_namespace.get(None, set())
        return sid in default_room
    except Exception:
        return False


def _decode_image(img_data):
    if not img_data:
        raise ValueError("Aucune donnee image fournie")

    encoded = img_data
    if "," in img_data:
        _, encoded = img_data.split(",", 1)

    try:
        img_bytes = base64.b64decode(encoded)
    except Exception as exc:
        raise ValueError("Erreur de decodage Base64") from exc

    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Donnees image invalides")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray_3ch = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    if np.array_equal(img, gray_3ch):
        raise ValueError("L'image doit etre en couleur")

    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB) / 255.0


def run_socket_server(socket_port, socket_id):
    app = Flask(__name__)

    if not DEBUG:
        logging.getLogger("werkzeug").setLevel(logging.ERROR)

    app.config["SECRET_KEY"] = APP_SECRET_KEY

    socketio_kwargs = {
        "cors_allowed_origins": CORS_ALLOWED_ORIGINS,
        "async_mode": SOCKET_ASYNC_MODE,
        "max_http_buffer_size": MAX_HTTP_BUFFER_SIZE,
    }
    if REVERSE_PROXY:
        socketio_kwargs["path"] = f"{socket_id}/socket.io"

    socketio = SocketIO(app, **socketio_kwargs)
    executor = ThreadPoolExecutor(max_workers=SOCKET_WORKERS)

    def emit_to_sid(sid, event, payload, namespace="/"):
        socketio.emit(event, payload, to=sid, namespace=namespace)

    def process_upload_image(sid, namespace, img_data):
        try:
            pixels = _decode_image(img_data)

            if not _is_client_connected(socketio, sid, namespace):
                return

            emitter = lambda event, payload: emit_to_sid(sid, event, payload, namespace)
            palette = simplify_convex_palette(pixels, 6, emitter=emitter)
            if palette is None:
                return

            vertices = palette["vertices"]
            faces = palette["faces"]
            emit_to_sid(
                sid,
                "convex_hull",
                {"type": "simplified", "vertices": vertices.tolist(), "faces": faces.tolist()},
                namespace,
            )

            if not _is_client_connected(socketio, sid, namespace):
                return

            extract_rgbxy_weights(vertices, pixels, emitter=emitter)
        except ValueError as exc:
            emit_to_sid(sid, "server_response", {"error": str(exc), "reset": True}, namespace)
        except Exception:
            logging.exception("Erreur lors du traitement upload_image")
            emit_to_sid(
                sid,
                "server_response",
                {"error": "Erreur interne pendant le traitement", "reset": True},
                namespace,
            )
        finally:
            emit_to_sid(sid, "thinking", {"thinking": False}, namespace)

    @socketio.on("connect")
    def handle_connect():
        emit("server_response", {"data": f"Connecte au serveur socket sur le port {socket_port}"})

    @socketio.on("disconnect")
    def handle_disconnect():
        logging.info("[Socket %s] Client deconnecte", socket_port)

    @socketio.on("upload_image")
    def handle_upload_image(data):
        emit("thinking", {"thinking": True})
        payload = data if isinstance(data, dict) else {}
        img_data = payload.get("image_data")

        if not img_data:
            emit("error", {"message": "Aucune donnee image fournie"})
            emit("thinking", {"thinking": False})
            return

        sid = request.sid
        namespace = request.namespace or "/"
        executor.submit(process_upload_image, sid, namespace, img_data)

    @socketio.on("harmonize")
    def handle_harmonize(data):
        emit("thinking", {"thinking": True})
        payload = data if isinstance(data, dict) else {}
        palette = payload.get("palette")
        if not palette:
            emit("error", {"message": "Aucune palette fournie"})
            emit("thinking", {"thinking": False})
            return

        try:
            harmonized = harmonize_palette(palette)
            emit("harmonized", harmonized)
        except Exception:
            logging.exception("Erreur lors de l'harmonisation")
            emit("error", {"message": "Erreur interne pendant l'harmonisation"})
        finally:
            emit("thinking", {"thinking": False})

    logging.info("Demarrage du serveur socket sur le port %s", socket_port)
    socketio.run(app, host=HOST, port=socket_port, debug=DEBUG)


load_balancer_port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.getenv("LOAD_BALANCER_PORT", "5000"))
socket_number = int(sys.argv[2]) if len(sys.argv) > 2 else int(os.getenv("SOCKET_NUMBER", "2"))
socket_ports = [load_balancer_port + i for i in range(1, socket_number + 1)]
lb_counter = 0


REVERSE_PROXY = _str_to_bool(os.getenv("REVERSE_PROXY"), default=False)
DEBUG = _str_to_bool(os.getenv("DEBUG"), default=False)
HOST = os.getenv("HOST", "127.0.0.1")
APP_SECRET_KEY = os.getenv("APP_SECRET_KEY", secrets.token_hex(32))
SOCKET_ASYNC_MODE = os.getenv("SOCKET_ASYNC_MODE", "gevent")
MAX_HTTP_BUFFER_SIZE = int(os.getenv("MAX_HTTP_BUFFER_SIZE", str(6 * 1024 * 1024)))
CORS_ALLOWED_ORIGINS = _parse_cors_origins(os.getenv("CORS_ALLOWED_ORIGINS"))
SOCKET_WORKERS = max(1, int(os.getenv("SOCKET_WORKERS", str(min(4, os.cpu_count() or 2)))))


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
    def harmonize():
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
            return jsonify({"success": False, "message": "Donnees manquantes"}), 400

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

    logging.info("Demarrage du serveur web sur le port %s", load_balancer_port)
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
