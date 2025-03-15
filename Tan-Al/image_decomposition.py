import numpy as np
from scipy.sparse import coo_matrix
from scipy.spatial import ConvexHull, Delaunay

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
    Calcule les poids barycentriques dans l'espace défini par 'vertices' pour chaque point de 'points'
    en utilisant la triangulation de Delaunay.
    Pour les points extérieurs (simplex == -1), on attribue un poids 1 pour le sommet le plus proche.
    Retourne une matrice creuse (CSR) de forme (n_points, n_vertices).
    """
    tri = Delaunay(vertices)
    simplex_indices = tri.find_simplex(points, tol=1e-6)

    valid = np.where(simplex_indices != -1)[0]
    invalid = np.where(simplex_indices == -1)[0]

    row_indices_list = []
    col_indices_list = []
    vals_list = []

    if valid.size > 0:
        # Calcul pour les points valides
        transform_valid = tri.transform[simplex_indices[valid], :points.shape[1]]
        delta_valid = points[valid] - tri.transform[simplex_indices[valid], points.shape[1]]
        bary_partial = np.einsum('...jk,...k->...j', transform_valid, delta_valid)
        bary_valid = np.c_[bary_partial, 1 - bary_partial.sum(axis=1)]

        # Les indices des sommets du simplex pour chaque point valide
        simplices_valid = tri.simplices[simplex_indices[valid]]

        row_indices_valid = np.repeat(valid, simplices_valid.shape[1])
        col_indices_valid = simplices_valid.ravel()
        vals_valid = bary_valid.ravel()

        row_indices_list.append(row_indices_valid)
        col_indices_list.append(col_indices_valid)
        vals_list.append(vals_valid)

    if invalid.size > 0:
        # Pour chaque point invalide, on choisit le sommet le plus proche
        for idx in invalid:
            distances = np.linalg.norm(points[idx] - vertices, axis=1)
            nearest = np.argmin(distances)
            row_indices_list.append(np.array([idx]))
            col_indices_list.append(np.array([nearest]))
            vals_list.append(np.array([1.0]))

    row_indices = np.concatenate(row_indices_list)
    col_indices = np.concatenate(col_indices_list)
    vals = np.concatenate(vals_list)

    return coo_matrix((vals, (row_indices, col_indices)), shape=(len(points), len(vertices))).tocsr()


def star_barycentrics(palette, hull_colors):
    """
    Calcule les poids barycentriques pour les couleurs extraites de l'enveloppe convexe
    en utilisant une triangulation en étoile basée sur un pivot.
    Si aucun simplexe ne fournit des poids valides pour un point, on attribue des poids uniformes.
    """
    # Choix du pivot : ici, la couleur la plus proche de l'origine (0,0,0)
    pivot_index = np.argmin(np.linalg.norm(palette, axis=1))

    # Calcul de l'enveloppe convexe sur la palette
    convex_hull = ConvexHull(palette)
    # Construction des simplexes en étoile (en excluant ceux contenant le pivot)
    simplices = [[pivot_index] + list(face) for face in convex_hull.simplices if pivot_index not in face]

    # Initialisation des poids à -1
    bary_coords = -np.ones((hull_colors.shape[0], palette.shape[0]))

    for simplex in simplices:
        pivot = palette[simplex[0]]
        A = (palette[simplex[1:]] - pivot).T
        b = (hull_colors - pivot).T
        try:
            bary_partial = np.linalg.solve(A, b).T
        except np.linalg.LinAlgError:
            continue  # Passer au simplexe suivant en cas d'erreur
        bary = np.hstack((1 - bary_partial.sum(axis=1, keepdims=True), bary_partial))
        valid_mask = (bary >= 0).all(axis=1)
        # On affecte les poids calculés pour les points valides
        bary_coords[valid_mask] = 0.0
        bary_coords[np.ix_(valid_mask, simplex)] = bary[valid_mask]

    # Pour les points n'ayant pas obtenu de solution (négatifs), on attribue des poids uniformes
    invalid = np.any(bary_coords < 0, axis=1)
    if np.any(invalid):
        bary_coords[invalid] = 1.0 / palette.shape[0]

    return bary_coords


def decompose_image(image, palette):
    """
    Décompose une image en couches pondérées selon une palette de couleurs.
    Le procédé consiste à :
      1. Convertir l'image en un tableau de pixels avec coordonnées RGBXY.
      2. Calculer l'enveloppe convexe dans cet espace.
      3. Extraire les couleurs RGB associées aux points de l'enveloppe.
      4. Calculer les poids barycentriques robustes dans l'espace RGBXY via Delaunay.
      5. Calculer les poids barycentriques via une triangulation en étoile.
      6. Combiner ces poids pour reconstituer l'image en couches.
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

    # Calcul des poids barycentriques dans l'espace RGBXY de manière robuste
    weights_rgbxy = delaunay_barycentrics(rgbxy_pixels[hull_indices], rgbxy_pixels)

    # Calcul des poids barycentriques pour les couleurs de l'enveloppe convexe par triangulation en étoile
    weights_palette = star_barycentrics(palette, hull_colors)

    # Combinaison des poids pour obtenir, pour chaque pixel, des poids pour chaque couleur de la palette
    weights = weights_rgbxy.dot(weights_palette)

    # Normalisation des poids pour chaque pixel (éviter que la somme soit nulle ou déviant de 1)
    sum_weights = np.array(weights.sum(axis=1)).flatten()
    sum_weights[sum_weights == 0] = 1  # éviter la division par zéro
    weights = (weights.T / sum_weights).T.clip(0, 1)

    # Reconstruction de l'image en sommant les couches pondérées par la palette
    height, width, _ = image.shape
    recomposed_image = np.zeros_like(image, dtype=float)
    for i in range(palette.shape[0]):
        # Calcul de la couche correspondant à la couleur i
        layer = weights[:, i].reshape(height, width, 1) * palette[i]
        recomposed_image += layer
        send_intermediate_image((layer * 255).round(), "layers")

    send_intermediate_image((recomposed_image * 255).round(), "previews")
    return recomposed_image