from scipy.spatial import Delaunay
import numpy as np


def compute_weighted_rmse(bin_centers, weights, hull_points):
    hull_delaunay = Delaunay(hull_points)
    inside = hull_delaunay.find_simplex(bin_centers) >= 0

    # Calcul vectorisé des distances minimales pour les points hors du hull
    distances = np.linalg.norm(bin_centers[:, None, :] - hull_points[None, :, :], axis=2).min(axis=1)
    distances[inside] = 0

    # Erreur RMSE pondérée
    rmse = np.sqrt(np.sum(weights * (distances ** 2)) / np.sum(weights))
    return rmse


def palette_simplification(points, hull_points):
    # Définition des bords pour 32 bins dans [0,1]
    bins = np.linspace(0, 1, 33)
    hist, edges = np.histogramdd(points, bins=(bins, bins, bins))

    # On récupère les indices des bins non vides et on calcule les centres
    non_empty = np.where(hist > 0)

    # On calcule les centres des bins
    bin_centers = [(edges[i][:-1] + edges[i][1:]) / 2 for i in range(3)]
    centers = np.array(np.meshgrid(bin_centers[0], bin_centers[1], bin_centers[2], indexing='ij')).reshape(3, -1).T

    # On récupère les centres associés aux bins non vides et leur poids
    weights = hist[non_empty]
    points_binned = centers[np.ravel_multi_index(non_empty, hist.shape)]

    rmse_tolerance = 2 / 255  # Seuil de RMSE
    while len(hull_points) > 10:
        rmse = compute_weighted_rmse(points_binned, weights, hull_points)
        if rmse > rmse_tolerance:
            break

        # Pour chaque couleur candidate à supprimer, on calcule la RMSE potentielle
        candidate_errors = []
        for i in range(len(hull_points)):
            new_hull = np.delete(hull_points, i, axis=0)
            candidate_errors.append(compute_weighted_rmse(points_binned, weights, new_hull))

        min_error_idx = np.argmin(candidate_errors)
        hull_points = np.delete(hull_points, min_error_idx, axis=0)
        print(f"Suppression de la couleur {min_error_idx}, {len(hull_points)} couleurs restantes")

    return hull_points
