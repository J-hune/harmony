import numpy as np

_EPS = 1e-12


def _safe(denominator):
    """Évite les divisions par zéro pour les triangles dégénérés."""
    return np.where(np.abs(denominator) < _EPS, _EPS, denominator)


def closest_points_on_triangles(points, a, b, c):
    """
    Calcule, pour chaque point, le point le plus proche sur chaque triangle.

    Implémentation vectorisée de l'algorithme par régions de Voronoï
    (Ericson, « Real-Time Collision Detection », section 5.1.5) : le point
    le plus proche peut être un sommet, un point d'une arête ou un point
    intérieur à la face.

    Paramètres:
      - points: np.array (N, 3)
      - a, b, c: np.array (F, 3), sommets des F triangles

    Retourne:
      - np.array (N, F, 3) des points les plus proches
    """
    p = np.asarray(points, dtype=float)[:, None, :]
    a, b, c = a[None], b[None], c[None]

    ab, ac = b - a, c - a
    ap, bp, cp = p - a, p - b, p - c
    d1, d2 = (ab * ap).sum(-1), (ac * ap).sum(-1)
    d3, d4 = (ab * bp).sum(-1), (ac * bp).sum(-1)
    d5, d6 = (ab * cp).sum(-1), (ac * cp).sum(-1)
    va = d3 * d6 - d5 * d4
    vb = d5 * d2 - d1 * d6
    vc = d1 * d4 - d3 * d2

    # Par défaut : projection à l'intérieur de la face
    denom = _safe(va + vb + vc)
    result = a + ab * (vb / denom)[..., None] + ac * (vc / denom)[..., None]

    # Arêtes (BC, AC puis AB)
    on_bc = (va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0)
    t = (d4 - d3) / _safe((d4 - d3) + (d5 - d6))
    result = np.where(on_bc[..., None], b + (c - b) * t[..., None], result)

    on_ac = (vb <= 0) & (d2 >= 0) & (d6 <= 0)
    t = d2 / _safe(d2 - d6)
    result = np.where(on_ac[..., None], a + ac * t[..., None], result)

    on_ab = (vc <= 0) & (d1 >= 0) & (d3 <= 0)
    t = d1 / _safe(d1 - d3)
    result = np.where(on_ab[..., None], a + ab * t[..., None], result)

    # Sommets (C, B puis A)
    result = np.where(((d6 >= 0) & (d5 <= d6))[..., None], c, result)
    result = np.where(((d3 >= 0) & (d4 <= d3))[..., None], b, result)
    result = np.where(((d1 <= 0) & (d2 <= 0))[..., None], a, result)
    return result


def closest_points_on_hull(points, hull_points, simplices):
    """
    Projette chaque point sur la surface d'une enveloppe convexe triangulée.

    Paramètres:
      - points: np.array (N, 3)
      - hull_points: np.array (M, 3), sommets de l'enveloppe
      - simplices: np.array (F, 3), faces triangulaires (indices dans hull_points)

    Retourne:
      - (closest, distances): np.array (N, 3) et np.array (N,)
    """
    points = np.asarray(points, dtype=float)
    triangles = hull_points[simplices]
    closest = np.empty_like(points)
    distances = np.empty(len(points))

    # Traitement par blocs pour borner la mémoire (N x F x 3)
    for start in range(0, len(points), 4096):
        chunk = points[start:start + 4096]
        candidates = closest_points_on_triangles(chunk, triangles[:, 0], triangles[:, 1], triangles[:, 2])
        sq_dist = ((candidates - chunk[:, None, :]) ** 2).sum(-1)
        best = sq_dist.argmin(axis=1)
        rows = np.arange(len(chunk))
        closest[start:start + len(chunk)] = candidates[rows, best]
        distances[start:start + len(chunk)] = np.sqrt(sq_dist[rows, best])
    return closest, distances
