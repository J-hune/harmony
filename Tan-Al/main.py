import base64
import cv2
import numpy as np
from scipy.spatial import ConvexHull
from flask import Flask, render_template
from flask_socketio import SocketIO, emit

from convex_hull import palette_simplification
from plot import plot_palette, plot_convex_hull_3d

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, cors_allowed_origins="*")  # Pour autoriser les connexions cross-origin en développement


@app.route('/')
def index():
    return render_template('index.html')  # La page HTML qui contiendra le code client


@socketio.on('connect')
def handle_connect():
    print("Flask: Un client est connecté")
    emit('server_response', {'data': 'Connecté au serveur'})


@socketio.on('disconnect')
def handle_disconnect():
    print("Flask: Un client s'est déconnecté")


@socketio.on('upload_image')
def handle_upload_image(data):
    """
    Attendu : data contient une clé "image_data" qui correspond à l'image encodée en base64.
    """
    try:
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
        pixels = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).reshape(-1, 3) / 255.0

        # Calcul de l'enveloppe convexe
        hull = ConvexHull(pixels)
        vertices = pixels[hull.vertices]
        faces = pixels[hull.simplices]

        emit('convex_hull', {'vertices': vertices.tolist(), 'faces': faces.tolist()})
    except Exception as e:
        emit('error', {'message': f"Erreur de traitement : {str(e)}"})


if __name__ == '__main__':
    socketio.run(app, debug=True, allow_unsafe_werkzeug=True)