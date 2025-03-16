import base64
import cv2
import numpy as np
from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit

from image_decomposition import extract_rgbxy_weights
from palette_simplification import simplify_convex_palette

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, cors_allowed_origins="*")  # Pour autoriser les connexions cross-origin en développement


@app.route('/')
def index():
    return render_template('index.html')  # La page HTML qui contiendra le code client


@socketio.on('connect')
def handle_connect():
    print("Flask: Un client est connecté -", request.remote_addr)
    emit('server_response', {'data': 'Connecté au serveur'})


@socketio.on('disconnect')
def handle_disconnect():
    print("Flask: Un client s'est déconnecté -", request.remote_addr)


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

    # Retirer l'en-tête si présent ("data:image/png;base64,")
    header, encoded = img_data.split(',', 1)
    img_bytes = base64.b64decode(encoded)

    # Conversion en tableau numpy puis décodage avec OpenCV
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img is None:
        emit('error', {'message': "Données image invalides"})
        return

    # Traitement : conversion en RGB et extraction des pixels normalisés
    pixels = cv2.cvtColor(img, cv2.COLOR_BGR2RGB) / 255.0

    # On vérifie si le client est toujours connecté pour éviter de calculer dans le vide
    if request.sid not in socketio.server.manager.rooms['/']:
        return

    # On calcule la palette simplifiée
    palette = simplify_convex_palette(pixels, 6)
    vertices = palette['vertices']
    faces = palette['faces']

    # On envoie les données au client
    emit('convex_hull', {'type':'simplified', 'vertices': vertices.tolist(), 'faces': faces.tolist()})

    # On vérifie si le client est toujours connecté pour éviter de calculer dans le vide
    if request.sid not in socketio.server.manager.rooms['/']:
        return

    # On décompose l'image en couches pondérées selon la palette de couleurs
    extract_rgbxy_weights(vertices, pixels)
    emit('thinking', {'thinking': False})


if __name__ == '__main__':
    socketio.run(app, debug=True, allow_unsafe_werkzeug=True)
