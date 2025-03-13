import base64
import numpy as np
import cv2
import matplotlib.pyplot as plt
from flask_socketio import emit


# --- Affichage du Convex Hull en 3D avec les couleurs ---
def plot_convex_hull_3d(points, hull_points):
    print("Affichage du Convex Hull en 3D...")

    fig = plt.figure(figsize=(12, 10))
    ax = fig.add_subplot(111, projection='3d')

    # On trace les points en 3D avec leurs couleurs
    ax.scatter(points[:, 0], points[:, 1], points[:, 2], c=points, s=10, marker="o", label="Pixels")

    # On trace les points du Convex Hull avec leurs couleurs et une bordure noire
    ax.scatter(hull_points[:, 0], hull_points[:, 1], hull_points[:, 2], c=hull_points, s=40,
               marker="o", edgecolor='black', linewidth=1.5, label="Hull Colors")

    ax.view_init(elev=30, azim=55)

    # Labels
    ax.set_xlabel("Red")
    ax.set_ylabel("Green")
    ax.set_zlabel("Blue")
    plt.tight_layout()
    plt.show()


# --- Affichage de la palette de couleurs ---
def plot_palette(colors, fixed_width=400, fixed_height=80):
    print("Affichage de la palette de couleurs...")

    # On convertit la liste de couleurs en tableau NumPy
    colors = np.array(colors)

    # On crée une image d'une seule ligne où chaque pixel correspond à une couleur
    palette = np.array([colors])

    # On redimensionne l'image à la taille désirée en utilisant l'interpolation "nearest"
    palette_rescaled = cv2.resize(palette, (fixed_width, fixed_height), interpolation=cv2.INTER_NEAREST)

    # Affichage avec matplotlib
    plt.figure(figsize=(4, 1))
    plt.imshow(palette_rescaled)
    plt.xticks([])
    plt.yticks([])
    plt.tight_layout()
    plt.show()


def send_intermediate_image(image, fixed_width=None, fixed_height=None):
    # On clamp les valeurs entre 0 et 1
    image = np.clip(image, 0, 1)
    image = (image * 255).astype(np.uint8)
    image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    if fixed_width is not None and fixed_height is not None:
        image = cv2.resize(image, (fixed_width, fixed_height), interpolation=cv2.INTER_NEAREST)

    _, img_encoded = cv2.imencode('.png', image)
    image_data_base64 = base64.b64encode(img_encoded).decode('utf-8')

    # On envoie l'image intermédiaire au client
    emit('intermediate_image', {'image_data': image_data_base64})
