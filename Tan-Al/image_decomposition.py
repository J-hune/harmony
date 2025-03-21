import time
import numpy as np
import scipy
from flask_socketio import emit
from numpy import median
from scipy.spatial import ConvexHull, Delaunay
from scipy import sparse

# -------------------------------------------------------------------------
# 1. Fonction de projection point-triangle
# -------------------------------------------------------------------------
def point_triangle_distance(P, triangle):
    """
    Calcule la distance entre un point P et un triangle (3x3).
    Retourne un dictionnaire contenant :
       - 'parameter': les coordonnées barycentriques [u, v, w] (u = 1-v-w)
       - 'closest': le point du triangle le plus proche de P
       - 'sqrDistance': la distance au carré
       - 'distance': la distance euclidienne
    """
    # triangle : (V0, V1, V2)
    V0, V1, V2 = triangle
    E0, E1 = V1 - V0, V2 - V0
    D = V0 - P

    a, b, c = np.dot(E0, E0), np.dot(E0, E1), np.dot(E1, E1)
    d, e = np.dot(E0, D), np.dot(E1, D)
    det = a * c - b * b

    s = (b * e - c * d)
    t = (b * d - a * e)

    # Cas des régions avec calcul vectorisé
    if (s + t) <= det:
        s = np.clip(s / det, 0, 1)
        t = np.clip(t / det, 0, 1)
    else:
        tmp0, tmp1 = b + d, c + e
        if tmp1 > tmp0:
            s = np.clip((tmp1 - tmp0) / (a - 2 * b + c), 0, 1)
            t = 1 - s
        else:
            t = np.clip(-e / c, 0, 1)
            s = 0

    u = 1 - s - t
    closest = u * V0 + s * V1 + t * V2
    diff = P - closest
    sqrDistance = np.dot(diff, diff)
    distance = np.sqrt(sqrDistance)
    return {'parameter': [u, s, t], 'closest': closest, 'sqrDistance': sqrDistance, 'distance': distance}


def extract_rgbxy_weights(palette_rgb, image_orig):
    """
    Extrait les poids de mélange RGBXY à partir d'une image.

    Args:
        palette_rgb (np.array): Couleurs de la palette (N, 3).
        image_orig (np.array): Image originale (H, W, 3).
    """
    n_colors = len(palette_rgb)
    img = image_orig.copy()
    height, width = img.shape[:2]

    # Création de la grille normalisée (XY)
    grid_x, grid_y = np.mgrid[0:height, 0:width]
    norm_grid = np.dstack((grid_x / float(height), grid_y / float(width)))
    combined_data = np.dstack((img, norm_grid))  # (H, W, 5)

    t0 = time.time()
    hull_combined = ConvexHull(combined_data.reshape(-1, 5))

    # Poids ASAP en RGB via la méthode Tan 2016
    hull_rgb = img.reshape(-1, 3)[hull_combined.vertices].reshape(-1, 1, 3)
    asap_weights = compute_asap_weights_tan2016(hull_rgb, palette_rgb)
    if asap_weights is None:
        return

    # Poids RGBXY via triangulation Delaunay
    hull_pts = hull_combined.points[hull_combined.vertices]
    delaunay_weights = compute_delaunay_barycentric_weights(hull_pts, hull_combined.points, option=3)
    emit("server_log", {"data": f"Le calcul des poids a pris {time.time() - t0:.2f} secondes"})

    # Combinaison des poids et reconstruction de l'image
    mix_weights = delaunay_weights.dot(asap_weights.reshape(-1, n_colors))
    mix_weights = mix_weights.reshape((height, width, -1)).clip(0, 1)

    recon_img = (mix_weights[..., None] * palette_rgb.reshape((1, 1, -1, 3))).sum(axis=2)
    err = recon_img * 255 - image_orig * 255
    rmse = np.sqrt(np.square(err.reshape(-1, 3)).sum(axis=-1).mean())
    emit("server_log", {"data": f"RMSE de reconstruction : {rmse:.2f}"})

    # Envoi des poids par couche via socket
    for layer in range(mix_weights.shape[-1]):
        emit("layer_weights", {
            "id": layer,
            "width": width,
            "height": height,
            "weights": mix_weights[:, :, layer].flatten().tolist()
        })


def compute_delaunay_barycentric_weights(hull_points, query_points, option=3):
    """
    Calcule les poids barycentriques via triangulation Delaunay.

    Args:
        hull_points (np.array): Points de l'enveloppe (M, dim).
        query_points (np.array): Points à évaluer (N, dim).
        option (int): Méthode utilisée (seule l'option 3 est supportée ici).

    Returns:
        scipy.sparse.csr_matrix: Matrice des poids barycentriques.
    """
    tri = Delaunay(hull_points)
    simplices = tri.find_simplex(query_points, tol=1e-6)
    X = tri.transform[simplices, :query_points.shape[1]]
    Y = query_points - tri.transform[simplices, query_points.shape[1]]
    bary = np.einsum('...jk,...k->...j', X, Y)
    bary = np.c_[bary, 1 - bary.sum(axis=1)]

    if option == 3:
        n_query = len(query_points)
        d = tri.simplices.shape[1]
        rows = np.repeat(np.arange(n_query).reshape(-1, 1), d, axis=1).ravel()
        cols = tri.simplices[simplices].ravel()
        vals = bary.ravel()
        weights = sparse.coo_matrix((vals, (rows, cols)), shape=(n_query, len(hull_points))).tocsr()
    else:
        raise NotImplementedError("Seule l'option 3 est implémentée.")

    return weights


def compute_asap_weights_tan2016(img_labels, tetra_palette):
    """
    Calcule les poids ASAP via triangulation et coordonnées barycentriques (méthode Tan 2016).

    Args:
        img_labels (np.array): Labels de l'image (peut être (H, W, 3) ou (N, 3)).
        tetra_palette (np.array): Palette de couleurs (sommets du tétraèdre, (N, 3)).

    Returns:
        np.array: Poids de mélange sous forme (H, W, N) ou (N, N) selon la forme d'entrée.
    """
    # Reordonnancement des sommets par distance à [0,0,0]
    dist = np.abs(tetra_palette - np.array([[0, 0, 0]])).sum(axis=-1)
    order = np.argsort(dist)
    ordered_palette = tetra_palette[order]

    # Préparation des labels
    flat_labels, orig_shape = prepare_labels(img_labels)

    # Calcul de l'enveloppe convexe et du Delaunay
    hull = ConvexHull(ordered_palette)
    delaunay_test = Delaunay(ordered_palette)

    # Correction des points hors de l'enveloppe
    labels_inside = enforce_inside_hull(flat_labels, hull, delaunay_test)

    # Création de la table de correspondance couleur -> indices
    color_map, uniq_labels = build_color_map(labels_inside)

    # Attribution des pixels aux faces du tétraèdre et calcul local des poids
    uniq_weights = assign_face_weights(uniq_labels, ordered_palette, hull, delaunay_test)
    if uniq_weights is None:
        return

    # Reconstruction des poids sur l'image entière
    full_weights = reconstruct_weights(labels_inside, color_map, uniq_weights, ordered_palette.shape[0])

    # Remise à l'ordre initial de la palette
    reordered_weights = np.ones_like(full_weights)
    reordered_weights[:, order] = full_weights
    reordered_weights = reordered_weights.reshape((orig_shape[0], orig_shape[1], -1))

    # Calcul d'erreur (affichage)
    recon = (reordered_weights[..., None] * tetra_palette.reshape((1, 1, -1, 3))).sum(axis=2)
    diff = recon.reshape(orig_shape) * 255 - img_labels.reshape(orig_shape) * 255
    diff_val = np.sqrt(np.square(diff.reshape(-1, 3)).sum(axis=-1))
    rmse = np.sqrt(np.square(diff.reshape(-1, 3)).sum() / diff.reshape(-1, 3).shape[0])

    emit('server_log', {'data': f"Erreur maximale : {diff_val.max():.2f} (distance euclidienne)"})
    emit('server_log', {'data': f"Erreur médiane : {median(diff_val):.2f} (distance euclidienne)"})
    emit('server_log', {'data': f"RMSE : {rmse:.2f}"})

    return reordered_weights


def prepare_labels(image_array):
    """
    Aplati les labels d'une image et retourne leur forme originale.

    Args:
        image_array (np.array): Image (H, W, 3) ou autre.

    Returns:
        tuple: (labels aplatis (N, 3), forme originale)
    """
    return image_array.reshape(-1, 3), image_array.shape


def enforce_inside_hull(labels, hull_obj, delaunay_obj):
    """
    Force les points à être à l'intérieur de l'enveloppe convexe.

    Args:
        labels (np.array): Points (N, 3).
        hull_obj (ConvexHull): Enveloppe convexe.
        delaunay_obj (Delaunay): Triangulation associée.

    Returns:
        np.array: Points ajustés.
    """
    inside = delaunay_obj.find_simplex(labels, tol=1e-8)
    corrected = labels.copy()
    for idx in range(labels.shape[0]):
        if inside[idx] < 0:
            dists = []
            close_pts = []
            for simplex in hull_obj.simplices:
                res = point_triangle_distance(labels[idx], hull_obj.points[simplex])
                dists.append(res['distance'])
                close_pts.append(res['closest'])
            corrected[idx] = close_pts[np.argmin(np.asarray(dists))]
    new_inside = delaunay_obj.find_simplex(corrected, tol=1e-8)
    assert np.all(new_inside >= 0), "Certains points sont toujours hors de l'enveloppe"
    return corrected


def build_color_map(labels):
    """
    Construit un dictionnaire associant chaque couleur unique aux indices de pixels correspondants.

    Args:
        labels (np.array): Points (N, 3).

    Returns:
        tuple: (dictionnaire couleur->indices, np.array des couleurs uniques)
    """
    uniq_labels, inverse = np.unique(labels, axis=0, return_inverse=True)
    # Construction du dictionnaire couleur -> indices
    col_map = {tuple(uniq_labels[i]): np.where(inverse == i)[0].tolist() for i in range(len(uniq_labels))}
    return col_map, uniq_labels


def assign_face_weights(uniq_labels, palette, hull_obj, delaunay_obj):
    """
    Associe les pixels uniques aux faces du tétraèdre et calcule leurs poids barycentriques.

    Args:
        uniq_labels (np.array): Couleurs uniques (K, 3).
        palette (np.array): Palette (N, 3).
        hull_obj (ConvexHull): Enveloppe convexe de la palette.
        delaunay_obj (Delaunay): Triangulation de la palette.

    Returns:
        np.array: Poids locaux (K, N).
    """
    face_pixel_map = {}
    n_vertices = palette.shape[0]
    for simplex in hull_obj.simplices:
        if np.all(simplex != 0):
            face_pixel_map.setdefault(tuple(simplex), [])

    remaining = set(range(len(uniq_labels)))
    for simplex in hull_obj.simplices:
        if np.all(simplex != 0):
            i, j, k = simplex
            tetra_face = np.array([palette[0], palette[i], palette[j], palette[k]])
            try:
                local_delaunay = Delaunay(tetra_face)
                if remaining:
                    indices = np.array(list(remaining))
                    test_labels = uniq_labels[indices]
                    inside = local_delaunay.find_simplex(test_labels, tol=1e-8)
                    valid = indices[inside >= 0]
                    face_pixel_map[tuple((i, j, k))] += valid.tolist()
                    remaining.difference_update(valid.tolist())
            except Exception:
                continue
    if len(remaining) > 0:
        emit('server_response', {'error': f"Erreur : {len(remaining)} pixels n'ont pas pu être assignés", 'reset': True})
        return

    uniq_weights = np.zeros((len(uniq_labels), n_vertices))
    for face, indices in face_pixel_map.items():
        face_sorted = sorted(face)
        cols = [0] + face_sorted
        face_pts = np.array([palette[idx] for idx in cols])
        if indices:
            bary = compute_delaunay_barycentric_weights(face_pts, uniq_labels[list(indices)], option=3)
            uniq_weights[np.array(indices)[:, None], cols] = bary.toarray().reshape(-1, len(cols))
    return uniq_weights


def reconstruct_weights(adj_labels, col_map, uniq_weights, n_vertices):
    """
    Reconstruit la matrice complète de poids à partir des poids uniques.

    Args:
        adj_labels (np.array): Points ajustés (N, 3).
        col_map (dict): Dictionnaire couleur -> indices.
        uniq_weights (np.array): Poids uniques (K, n_vertices).
        n_vertices (int): Nombre de sommets.

    Returns:
        np.array: Poids de mélange (N, n_vertices).
    """
    num_pixels = adj_labels.shape[0]
    full_w = np.zeros((num_pixels, n_vertices))
    # Itération sur les couleurs uniques
    for idx, unique_col in enumerate(np.array(list(col_map.keys()))):
        indices = col_map[tuple(unique_col)]
        full_w[indices, :] = uniq_weights[idx, :]
    return full_w
