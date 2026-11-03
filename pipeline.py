"""
Traitement d'une image, exécuté dans un processus du pool de calcul.

Les événements destinés au navigateur (journal, palette, couches...) sont
déposés dans une file partagée ; le serveur les relaie au client au fil de l'eau.
"""
import base64
import logging

import cv2
import numpy as np

from image_decomposition import extract_rgbxy_weights
from palette_simplification import simplify_convex_palette

# Marqueur de fin déposé dans la file une fois le traitement terminé
DONE = "__done__"


def _mpx(pixels, digits=None):
    """Mégapixels au format français (virgule décimale)."""
    value = f"{pixels / 1e6:.{digits}f}" if digits is not None else f"{pixels / 1e6:g}"
    return value.replace(".", ",")


def too_large_message(width, height, max_pixels):
    """Message affiché quand une image dépasse la taille autorisée (dimensions inconnues : None)."""
    limit = f"La limite est de {_mpx(max_pixels)} Mpx : réduisez-la avant de l'envoyer."
    if width is None or height is None:
        return f"Cette image est beaucoup trop grande. {limit}"
    return f"Cette image fait {width}×{height} pixels ({_mpx(width * height, 1)} Mpx). {limit}"


def decode_image(img_data, max_pixels=None):
    """
    Décode une image envoyée en data URL (ou base64 brut).

    Une image de plus de `max_pixels` est refusée : la mémoire nécessaire au
    calcul croît avec le nombre de pixels. (Le serveur la refuse normalement
    avant même de la mettre en file ; ceci est une seconde vérification.)

    Retourne les pixels RGB dans [0, 1].
    """
    if not img_data:
        raise ValueError("Aucune donnée image fournie")

    encoded = img_data.split(",", 1)[1] if "," in img_data else img_data
    try:
        img_bytes = base64.b64decode(encoded)
    except Exception as exc:
        raise ValueError("Erreur de décodage Base64") from exc

    img = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Données image invalides")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    if np.array_equal(img, cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)):
        raise ValueError("L'image doit être en couleur")

    if max_pixels and img.shape[0] * img.shape[1] > max_pixels:
        raise ValueError(too_large_message(img.shape[1], img.shape[0], max_pixels))

    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB) / 255.0


def run_pipeline(img_data, max_pixels, events):
    """
    Palette simplifiée puis décomposition en couches RGBXY.

    Args:
        img_data (str): Image en data URL.
        max_pixels (int): Taille maximale de l'image traitée.
        events: File partagée (multiprocessing) recevant les tuples (événement, données).
    """
    def emitter(event, payload):
        events.put((event, payload))

    try:
        emitter("server_log", {"data": "Analyse de l'image démarrée. Extraction des couleurs dominantes..."})
        pixels = decode_image(img_data, max_pixels)

        palette = simplify_convex_palette(pixels, 6, emitter=emitter)
        if palette is None:
            return

        vertices = palette["vertices"]
        emitter("convex_hull", {"type": "simplified", "vertices": vertices.tolist(), "faces": palette["faces"].tolist()})
        emitter("server_log", {"data": "Palette simplifiée validée. Calcul des couches RGBXY en cours..."})
        extract_rgbxy_weights(vertices, pixels, emitter=emitter)
        emitter("server_log", {"data": "Traitement terminé. Les couches sont prêtes."})
    except ValueError as exc:
        emitter("server_response", {"error": str(exc), "reset": True})
    except Exception:
        logging.exception("Erreur lors du traitement de l'image")
        emitter("server_response", {"error": "Une erreur interne a interrompu le traitement de l'image.", "reset": True})
    finally:
        events.put((DONE, None))
