import json
import multiprocessing
import base64
import sys

import cv2
import logging
import numpy as np
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit

from image_decomposition import extract_rgbxy_weights
from palette_simplification import simplify_convex_palette
from palette_harmonization import harmonize_palette

REVERSE_PROXY = False
DEBUG = False

# --- Serveur Socket (autant de serveurs que de ports) ---
def run_socket_server(socket_port, socket_id):
    app = Flask(__name__)

    # On désactive les logs de werkzeug si on n'est pas en mode debug
    if not DEBUG:
        log = logging.getLogger('werkzeug')
        log.setLevel(logging.ERROR)

    app.config['SECRET_KEY'] = 'WaL&vOxn#JDK0lJTi6n1FGRDdEEpu^fFQfCDMnRd@SB'

    # On ouvre le serveur avec un buffer de 10Mo pour éviter les erreurs de dépassement de mémoire
    if REVERSE_PROXY:
        socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading", path=str(socket_id) + "/socket.io", max_http_buffer_size=1024 * 1024 * 6)
    else:
        socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading", max_http_buffer_size=1024 * 1024 * 6)

    @socketio.on('connect')
    def handle_connect():
        print(f"[Socket {socket_port}] Client connecté")
        emit('server_response', {'data': f'Connecté au serveur socket sur le port {socket_port}'})


    @socketio.on('disconnect')
    def handle_disconnect():
        print(f"[Socket {socket_port}] Client déconnecté")


    @socketio.on('upload_image')
    def handle_upload_image(data):
        """
        Attendu : data contient une clé "image_data" qui correspond à l'image encodée en base64.
        """
        emit('thinking', {'thinking': True})
        img_data = data.get('image_data')
        if not img_data:
            emit('error', {'message': 'Aucune donnée image fournie'})
            return

        # Suppression de l'en-tête si présent (ex: "data:image/png;base64,")
        try:
            header, encoded = img_data.split(',', 1)
        except Exception:
            emit('error', {'message': "Données image invalides"})
            return

        try:
            img_bytes = base64.b64decode(encoded)
        except Exception:
            emit('error', {'message': "Erreur de décodage Base64"})
            return

        # Conversion en tableau numpy puis décodage avec OpenCV
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            emit('server_response', {'error': "Données image invalides", 'reset': True})
            return

        # On vérifie que l'image n'est pas en noir et blanc
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        gray_3ch = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
        if np.array_equal(img, gray_3ch):
            emit('server_response', {'error': "L'image doit être en couleur", 'reset': True})
            return

        # Traitement : conversion en RGB et extraction des pixels normalisés
        pixels = cv2.cvtColor(img, cv2.COLOR_BGR2RGB) / 255.0

        if '/' not in socketio.server.manager.rooms or request.sid not in socketio.server.manager.rooms['/']:
            print(f"[Socket {socket_port}] Client déconnecté avant le traitement")
            return

        # Calcul de la palette simplifiée
        palette = simplify_convex_palette(pixels, 6)
        if palette is None:
            return

        vertices = palette['vertices']
        faces = palette['faces']
        emit('convex_hull', {'type': 'simplified', 'vertices': vertices.tolist(), 'faces': faces.tolist()})

        # On vérifie si le client est toujours connecté pour éviter de calculer dans le vide
        if '/' not in socketio.server.manager.rooms or request.sid not in socketio.server.manager.rooms['/']:
            print(f"[Socket {socket_port}] Client déconnecté avant le traitement")
            return

        # On décompose l'image en couches pondérées selon la palette de couleurs
        extract_rgbxy_weights(vertices, pixels)
        emit('thinking', {'thinking': False})

    @socketio.on("harmonize")
    def handle_harmonize(data):
        """
        Attendu : data contient une clé "palette" qui correspond à la palette de couleurs à harmoniser. (array de RGB)
        """
        emit('thinking', {'thinking': True})
        palette = data.get('palette')
        if not palette:
            emit('error', {'message': 'Aucune palette fournie'})
            return

        # On harmonise la palette
        harmonized = harmonize_palette(palette)
        emit('harmonized', harmonized)
        emit('thinking', {'thinking': False})

    print(f"Démarrage du serveur socket sur le port {socket_port}")
    socketio.run(app, port=socket_port, debug=False, allow_unsafe_werkzeug=True)


# --- Serveur Web (load balancer) sur le port donné ---

# Liste des ports utilisés par les serveurs socket
load_balancer_port = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
socket_number = int(sys.argv[2]) if len(sys.argv) > 2 else 2
socket_ports = [load_balancer_port + i for i in range(1, socket_number + 1)]
lb_counter = 0  # compteur pour le round-robin


def get_next_socket_id():
    global lb_counter
    socket_port = socket_ports[lb_counter % len(socket_ports)]
    socket_id = socket_port - load_balancer_port
    lb_counter += 1
    return [socket_id, socket_port]


def run_web_server():
    app = Flask(__name__)
    app.config['SECRET_KEY'] = 'secret!'
    img_ids = json.load(open('./ids.json'))

    if not DEBUG:
        log = logging.getLogger('werkzeug')
        log.setLevel(logging.ERROR)

    @app.route('/')
    def index():
        return render_template('index.html')

    @app.route('/app')
    def harmonize():
        return render_template('app.html')

    @app.route('/feedback')
    def form():
        return render_template('feedback.html')

    @app.route('/img_ids')
    def get_img_ids():
        return jsonify(img_ids)

    @app.route('/form/feedback', methods=['POST'])
    def form_feedback():
        # L'utilisateur nous donne un feedback qui contient l'id de l'image, les deux harmonies présentées et le choix de l'utilisateur
        # On l'enregistre dans un fichier csv
        data = request.get_json()
        img_id = data.get('id')
        harmony1 = data.get('harmonyOption1')
        harmony2 = data.get('harmonyOption2')
        choice = data.get('harmonyChosen')

        # On vérifie que toutes les données sont présentes
        if not img_id or not harmony1 or not harmony2 or not choice:
            return jsonify({'success': False, 'message': 'Données manquantes'}), 400

        # On enregistre les données dans un fichier CSV
        with open('feedback.csv', 'a') as f:
            f.write(f"{img_id},{harmony1},{harmony2},{choice}\n")
        return jsonify({'success': True}), 200

    @app.errorhandler(404)
    def page_not_found(e):
        return render_template('index.html'), 404

    @app.route('/get_socket_id')
    def get_socket_id():
        socket_id, socket_port = get_next_socket_id()

        if REVERSE_PROXY:
            return jsonify({'socket_id': socket_id})
        else:
            return jsonify({'socket_port': socket_port})


    print("Démarrage du serveur Web sur le port", load_balancer_port)
    app.run(port=load_balancer_port, debug=False)


# --- Lancement des serveurs dans des processus séparés ---
if __name__ == '__main__':
    DEBUG = True
    REVERSE_PROXY = False

    # On démarre les serveurs socket dans des processus séparés
    processes = []
    print(socket_ports)
    for (i, port) in enumerate(socket_ports):
        p = multiprocessing.Process(target=run_socket_server, args=(port, i + 1,))
        p.start()
        processes.append(p)

    # On démarre le serveur Web
    run_web_server()

    # On attend la fin des processus
    for p in processes:
        p.join()