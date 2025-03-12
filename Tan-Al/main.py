import os

import numpy as np
from PIL import Image

import cv2
from scipy.spatial import ConvexHull

from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
from werkzeug.utils import secure_filename

from convex_hull import palette_simplification
from plot import plot_palette, plot_convex_hull_3d

app = Flask(__name__)
CORS(app)

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png"}

def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route("/")
def hello_world():
    return render_template("index.html")

@app.route("/api/upload", methods=["POST"])
def upload():
    if "image" not in request.files:
        return jsonify({"error": "No file part"}), 400

    file = request.files["image"]

    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": "Invalid file extension"}), 400

    # Convertir l'image en un tableau numpy pour OpenCV
    try:
        in_memory_file = np.frombuffer(file.read(), dtype=np.uint8)
        img = cv2.imdecode(in_memory_file, cv2.IMREAD_COLOR)  # Lecture avec OpenCV

        if img is None:
            return jsonify({"error": "Invalid image data"}), 400

        # Exemple de traitement : convertir en niveaux de gris
        pixels = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).reshape(-1, 3) / 255.0

        hull = ConvexHull(pixels)
        hull_colors = pixels[hull.vertices]
        print(hull_colors)

        # On peut maintenant utiliser `img` ou `gray` pour du traitement OpenCV
        return jsonify({"message": "Image processed successfully"}), 200

    except Exception as e:
        return jsonify({"error": f"Processing error: {str(e)}"}), 500


def main():
    # On charge l'image avec OpenCV
    image = cv2.imread("0.jpg")
    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    pixels = image_rgb.reshape(-1, 3) / 255.0  # Normalisation [0, 1]

    # On calcule le Convex Hull
    hull = ConvexHull(pixels)
    hull_colors = pixels[hull.vertices]  # On récupère les couleurs du hull

    # On simplifie la palette de couleurs
    simplified_hull_colors = palette_simplification(pixels, hull_colors)

    # Affichage du Convex Hull
    plot_convex_hull_3d(pixels, simplified_hull_colors)

    # Affichage de la palette de couleurs
    plot_palette(simplified_hull_colors)


if __name__ == "__main__":
    app.run(debug=True)
    #main()
