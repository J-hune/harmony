import numpy as np
from scipy.sparse import coo_matrix
from scipy.spatial import ConvexHull, Delaunay
import matplotlib.pyplot as plt

from plot import send_intermediate_image


def convert_rgb_to_rgbxy(image):
    """
    Convertit une image RGB en un tableau de pixels avec coordonnées RGBXY.

    Paramètres :
        image : tableau NumPy de forme (hauteur, largeur, 3) représentant une image RGB.

    Retourne :
        Un tableau NumPy de forme (N, 5) où chaque ligne contient (R, G, B, X, Y),
        avec N = hauteur * largeur.
    """
    height, width, _ = image.shape  # Dimensions de l'image

    # Création des indices X et Y pour chaque pixel
    y_indices, x_indices = np.meshgrid(np.arange(height), np.arange(width), indexing="ij")

    # Assemblage des canaux de couleur et des coordonnées en un tableau (R, G, B, X, Y)
    return np.column_stack((image.reshape(-1, 3), x_indices.ravel(), y_indices.ravel()))


def delaunay_barycentrics(vertices, points):
    """
    Calcule les poids barycentriques pour chaque point via la triangulation de Delaunay.

    Paramètres :
        vertices : tableau NumPy de forme (n_vertices, d) représentant les sommets de l'enveloppe convexe.
        points   : tableau NumPy de forme (n_points, d) pour lesquels on souhaite calculer les coordonnées barycentriques.

    Retourne :
        Une matrice creuse CSR de forme (n_points, n_vertices) contenant les poids barycentriques.
    """
    # Calcul de la triangulation de Delaunay
    tri = Delaunay(vertices)

    # Pour chaque point, trouver l'indice du simplex (simplexe) qui le contient (ou -1 s'il n'est pas contenu)
    simplex_indices = tri.find_simplex(points, tol=1e-6)

    # Vérification que tous les points se trouvent à l'intérieur de l'enveloppe convexe
    assert (simplex_indices != -1).all(), "Certains points sont en dehors de l'enveloppe convexe."

    # Transformation affine associée à chaque simplex contenant le point
    transform = tri.transform[simplex_indices, :points.shape[1]]

    # Décalage de chaque point par rapport à l'origine de son simplex
    delta = points - tri.transform[simplex_indices, points.shape[1]]

    # Calcul des coordonnées barycentriques (hors dernier coefficient)
    bary_partial = np.einsum('...jk,...k->...j', transform, delta)
    bary_coords = np.c_[bary_partial, 1 - bary_partial.sum(axis=1)]

    # Construction de la matrice creuse
    row_indices = np.tile(np.arange(len(points)).reshape(-1, 1), (1, len(tri.simplices[0]))).ravel()
    col_indices = tri.simplices[simplex_indices].ravel()
    vals = bary_coords.ravel()

    return coo_matrix((vals, (row_indices, col_indices)), shape=(len(points), len(vertices))).tocsr()


def star_barycentrics(palette, hull_colors):
    """
    Calcule les coordonnées barycentriques pour les couleurs extraites de l'enveloppe convexe,
    en utilisant une triangulation en étoile ("star triangulation") basée sur un vertex pivot.

    Paramètres :
        palette     : tableau NumPy de forme (n_palette, 3) représentant les couleurs de référence.
        hull_colors : tableau NumPy de forme (n_hull, 3) représentant les couleurs extraites de l'enveloppe convexe.

    Retourne :
        Un tableau NumPy de forme (n_hull, n_palette) contenant les poids barycentriques.
    """
    # Sélection du vertex pivot (le plus proche de l'origine)
    pivot_index = np.argmin(np.linalg.norm(palette, axis=1))

    # Construction de l'enveloppe convexe des couleurs de la palette
    convex_hull = ConvexHull(palette)

    # Création des simplexes en étoile en combinant le pivot avec chaque face qui ne le contient pas
    simplices = [[pivot_index] + list(face) for face in convex_hull.simplices if pivot_index not in face]

    # Initialisation du tableau des coordonnées barycentriques avec des valeurs négatives
    bary_coords = -np.ones((hull_colors.shape[0], palette.shape[0]))

    # Calcul pour chaque simplexe
    for simplex in simplices:
        # Le pivot est le premier élément du simplexe
        pivot = palette[simplex[0]]
        # Matrice du système pour les autres sommets du simplexe
        A = (palette[simplex[1:]] - pivot).T
        # Terme constant pour tous les hull_colors
        b = (hull_colors - pivot).T
        try:
            # Résolution du système linéaire pour obtenir les poids des sommets non pivot
            bary_partial = np.linalg.solve(A, b).T
        except np.linalg.LinAlgError:
            continue  # Si le système est singulier, on passe au simplexe suivant

        # Ajout du poids du pivot : 1 - somme des autres poids
        bary = np.hstack((1 - bary_partial.sum(axis=1, keepdims=True), bary_partial))

        # Détection des points pour lesquels les coordonnées sont valides (>= 0)
        valid_mask = (bary >= 0).all(axis=1)
        # Mise à zéro pour ces points, puis affectation des poids pour les indices du simplexe
        bary_coords[valid_mask] = 0.0
        bary_coords[np.ix_(valid_mask, simplex)] = bary[valid_mask]

    return bary_coords


def decompose_image(image, palette):
    """
    Décompose une image en couches pondérées selon une palette de couleurs.

    Le procédé consiste à :
      1. Convertir l'image en un tableau de pixels avec coordonnées (R, G, B, X, Y).
      2. Calculer l'enveloppe convexe dans cet espace.
      3. Extraire les points de l'enveloppe convexe et récupérer leurs valeurs RGB.
      4. Calculer les poids barycentriques via une triangulation de Delaunay dans l'espace RGBXY.
      5. Calculer les poids barycentriques pour les couleurs de l'enveloppe convexe via une triangulation en étoile.
      6. Combiner ces poids pour reconstituer l'image en couches associées à chaque couleur de la palette.

    Paramètres :
        image   : tableau NumPy de forme (hauteur, largeur, 3) représentant l'image.
        palette : tableau NumPy de forme (n_palette, 3) représentant la palette de couleurs.
    """
    # Conversion de l'image en tableau de pixels RGBXY
    rgbxy_pixels = convert_rgb_to_rgbxy(image)

    # Calcul de l'enveloppe convexe dans l'espace RGBXY
    hull = ConvexHull(rgbxy_pixels)
    hull_indices = hull.vertices
    hull_points = rgbxy_pixels[hull_indices]

    # Récupération des couleurs RGB correspondant aux points de l'enveloppe convexe
    x_coords = hull_points[:, 3].astype(int)
    y_coords = hull_points[:, 4].astype(int)
    hull_colors = image[y_coords, x_coords]

    # Calcul des poids barycentriques dans l'espace RGBXY par Delaunay
    weights_rgbxy = delaunay_barycentrics(rgbxy_pixels[hull_indices], rgbxy_pixels)

    # Calcul des poids barycentriques pour les couleurs de l'enveloppe convexe par triangulation en étoile
    weights_palette = star_barycentrics(palette, hull_colors)

    # Combinaison des poids pour obtenir, pour chaque pixel, des poids pour chaque couleur de la palette
    weights = weights_rgbxy.dot(weights_palette)

    # Recomposition de l'image en sommant les couches pondérées par la palette
    height, width, _ = image.shape
    recomposed_image = np.zeros_like(image, dtype=float)
    for i in range(palette.shape[0]):
        # Vectorisation : reshape des poids pour former une image 2D puis multiplication par la couleur
        layer = weights[:, i].reshape(height, width, 1) * palette[i]
        recomposed_image += layer
        send_intermediate_image(layer, "layers")

    send_intermediate_image(recomposed_image, "previews")

    plt.axis('off')
    plt.tight_layout()
    plt.imshow(recomposed_image)
    plt.show()
