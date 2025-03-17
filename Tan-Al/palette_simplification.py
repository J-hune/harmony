import cvxopt
import cvxopt.solvers
import numpy as np
from flask_socketio import emit
from scipy.spatial import ConvexHull, Delaunay


def compute_rmse(points, hull_points):
    """
    Calcule l'erreur quadratique moyenne (RMSE) entre un nuage de points
    et une enveloppe convexe donnée.

    Paramètres:
      - points: np.array de forme (N, 3) (par exemple, des couleurs ou positions)
      - hull_points: np.array des sommets de l'enveloppe convexe

    Retourne:
      - La RMSE (float)
    """
    # On construit une triangulation de Delaunay à partir des sommets de l'enveloppe
    # pour déterminer quels points se trouvent à l'intérieur de celle-ci.
    delaunay = Delaunay(hull_points)
    inside = delaunay.find_simplex(points) >= 0

    # Pour les points extérieurs, on calcule la distance minimale à chacun des sommets de l'enveloppe.
    distances = np.linalg.norm(points[:, None, :] - hull_points[None, :, :], axis=2)
    min_distances = np.min(distances, axis=1)
    min_distances[inside] = 0

    # On retourne la racine carrée de la moyenne des carrés des distances minimales.
    return np.sqrt(np.mean(min_distances ** 2))


def convert_convex_hull_faces(hull):
    """
    Convertit les indices de faces générés par ConvexHull (SciPy)
    en indices de base et réordonne les sommets de chaque face
    pour assurer une orientation cohérente.

    Paramètres:
      - hull: objet ConvexHull obtenu à partir du nuage de points

    Retourne:
      - Une liste de faces (chaque face est une liste d'indices)
    """
    hull_vertices_coords = hull.points[hull.vertices]

    # On ré-indexe les faces générées par ConvexHull.
    new_indices = -1 * np.ones(hull.points.shape[0], dtype=np.int32)
    new_indices[hull.vertices] = np.arange(len(hull.vertices))
    faces = np.asarray([new_indices[face] for face in hull.simplices])

    # On parcourt chaque face pour vérifier et ajuster son orientation.
    for i in range(len(faces)):
        face_coords = hull_vertices_coords[faces[i]]
        expected_normal = hull.equations[i, :3]
        # On calcule la normale à partir des trois premiers points de la face.
        p0, p1, p2 = face_coords[0], face_coords[1], face_coords[2]
        computed_normal = np.cross(p1 - p0, p2 - p0)
        if np.dot(expected_normal, computed_normal) < 0:
            # On inverse l'ordre de deux sommets pour corriger l'orientation.
            faces[i][[0, 1]] = faces[i][[1, 0]]
    return faces.tolist()


def compute_tetrahedron_volume(triangle, point):
    """
    Calcule le volume du tétraèdre formé par un triangle et un point extérieur.

    Paramètres:
      - triangle: np.array de forme (3,3) représentant les sommets du triangle
      - point: np.array de forme (3,) représentant le point extérieur

    Retourne:
      - Le volume absolu du tétraèdre (float)
    """
    # On calcule la normale du triangle.
    normal = np.cross(triangle[1] - triangle[0], triangle[2] - triangle[0])
    # On retourne le volume absolu, défini comme |dot(normal, (point - triangle[0]))| / 6.
    return abs(np.dot(normal, point - triangle[0])) / 6.0


def edge_normal_test(vertices, faces, face_indices, vertex_index1, vertex_index2):
    """
    Vérifie la compatibilité des normales des faces adjacentes à une arête donnée.

    Pour une arête (vertex_index1, vertex_index2), cette fonction
    extrait les faces associées, puis :
      - Si, après retrait des deux sommets, il reste un seul sommet (face centrale)
        pour exactement deux faces, elle calcule la normale moyenne.
      - Ensuite, pour chaque face "complète", vérifie que la normale calculée
        est compatible avec la normale moyenne.

    Paramètres:
      - vertices: np.array des sommets courants
      - faces: liste des faces (chaque face est un triplet d'indices)
      - face_indices: indices des faces à vérifier
      - vertex_index1, vertex_index2: indices formant l'arête

    Retourne:
      - 1 si le test passe, 0 sinon.
    """
    adjacent_full_faces = []
    central_faces = []

    for idx in face_indices:
        face = list(faces[idx])
        temp_face = face.copy()
        if vertex_index1 in temp_face:
            # On retire le premier sommet de l'arête.
            temp_face.remove(vertex_index1)
        if vertex_index2 in temp_face:
            # On retire le second sommet de l'arête.
            temp_face.remove(vertex_index2)
        if len(temp_face) == 2:
            # On considère la face complète.
            adjacent_full_faces.append(np.array([vertices[i] for i in face]))
        elif len(temp_face) == 1:
            # On considère la face centrale.
            central_faces.append(np.array([vertices[i] for i in face]))

    if len(central_faces) != 2:
        return 0

    normals = []
    # On calcule et normalise les normales des faces centrales.
    for face in central_faces:
        n = np.cross(face[1] - face[0], face[2] - face[0])
        n = n / np.linalg.norm(n)
        normals.append(n)
    avg_normal = np.mean(np.array(normals), axis=0)

    # On vérifie que chaque face complète possède une normale compatible avec la normale moyenne.
    for face in adjacent_full_faces:
        n = np.cross(face[1] - face[0], face[2] - face[0])
        if np.dot(avg_normal, n) < -1e-5:
            return 0
    return 1


def vertex_face_neighbors(vertex_index, faces):
    """
    Renvoie la liste des indices de faces contenant le sommet donné.

    Paramètres:
      - vertex_index: indice du sommet à rechercher
      - faces: liste des faces (chaque face est une liste ou un triplet d'indices)

    Retourne:
      - Une liste d'indices de faces.
    """
    neighbors = []
    for i, face in enumerate(faces):
        if vertex_index in face:
            # On ajoute l'indice de la face si elle contient le sommet recherché.
            neighbors.append(i)
    return neighbors


def get_edges_from_faces(faces):
    """
    Extrait l'ensemble des arêtes uniques à partir d'une liste de faces.

    Chaque face étant définie par trois indices, la fonction génère
    toutes les paires triées pour éviter les doublons.

    Paramètres:
      - faces: liste de faces (triplets d'indices)

    Retourne:
      - Une liste d'arêtes, où chaque arête est un tuple (i, j) avec i < j.
    """
    edges = set()
    for face in faces:
        # On ajoute chaque arête en triant les indices pour éviter les doublons.
        edges.add(tuple(sorted((face[0], face[1]))))
        edges.add(tuple(sorted((face[1], face[2]))))
        edges.add(tuple(sorted((face[2], face[0]))))
    return list(edges)


def compute_edge_collapse_candidate(edge, vertices, faces):
    """
    Calcule le point candidat pour la fusion (collapse) d'une arête donnée
    en résolvant un problème d'optimisation linéaire (LP).

    Paramètres:
      - edge: tuple (vertex_index1, vertex_index2) définissant l'arête candidate
      - vertices: np.array des sommets courants (forme (N,3))
      - faces: liste des faces courantes (chaque face est un triplet d'indices)

    Retourne:
      - (nouveau_sommet, volume_ajoute) si le LP est résolu de manière optimale,
      - None sinon.
    """
    v1, v2 = edge
    # On récupère les indices de faces associées aux deux sommets de l'arête.
    faces_v1 = vertex_face_neighbors(v1, faces)
    faces_v2 = vertex_face_neighbors(v2, faces)
    combined_face_indices = list(set(faces_v1) | set(faces_v2))

    related_triangles = []
    A_list = []
    b_list = []
    cost_vector = np.zeros(3)

    # On construit le problème linéaire à partir des faces adjacentes.
    for face_idx in combined_face_indices:
        face_indices = faces[face_idx]
        p0 = vertices[face_indices[0]]
        p1 = vertices[face_indices[1]]
        p2 = vertices[face_indices[2]]
        triangle = np.array([p0, p1, p2])
        related_triangles.append(triangle)
        # On calcule la normale normalisée du triangle.
        normal = np.cross(p1 - p0, p2 - p0)
        norm_val = np.linalg.norm(normal)
        if norm_val == 0:
            continue
        normal = normal / norm_val
        A_list.append(normal)
        b_list.append(np.dot(normal, p0))
        cost_vector += normal

    if len(A_list) == 0:
        return None

    # On met en place le problème LP :
    # On cherche à minimiser c^T x avec c = cost_vector,
    # sous contraintes : -A x <= -b (équivalent à A x >= b).
    A_matrix = -np.array(A_list)
    b_vector = -np.array(b_list)
    c_vector = cost_vector

    cvxopt.solvers.options['show_progress'] = False
    cvxopt.solvers.options['glpk'] = dict(msg_lev='GLP_MSG_OFF')
    res = cvxopt.solvers.lp(cvxopt.matrix(c_vector),
                            cvxopt.matrix(A_matrix),
                            cvxopt.matrix(b_vector),
                            solver='glpk')

    if res['status'] == 'optimal':
        new_vertex = np.array(res['x']).squeeze()
        # On calcule le volume ajouté en sommant les volumes des tétraèdres
        # formés par chacune des faces adjacentes et le nouveau sommet.
        added_volume = sum(compute_tetrahedron_volume(triangle, new_vertex)
                           for triangle in related_triangles)
        return new_vertex, added_volume
    else:
        # En cas d'échec du LP, on teste la compatibilité des normales.
        if edge_normal_test(vertices, faces, combined_face_indices, v1, v2) == 1:
            return None
    return None


def update_convex_hull(points):
    """
    Met à jour l'enveloppe convexe à partir d'un ensemble de points.

    Paramètres:
      - points: np.array de forme (N, 3)

    Retourne:
      - (hull_vertices, hull_faces) où :
          * hull_vertices est un np.array des sommets de l'enveloppe
          * hull_faces est une liste de faces (triplets d'indices) avec orientation cohérente.
    """
    # On calcule l'enveloppe convexe à partir des points fournis.
    hull = ConvexHull(points)
    # On récupère les sommets de l'enveloppe.
    hull_vertices = points[hull.vertices]
    # On convertit les faces pour obtenir une orientation cohérente.
    hull_faces = np.array(convert_convex_hull_faces(hull))
    return hull_vertices, hull_faces


def simplify_convex_palette(points, target_vertices=10, max_iterations=500):
    """
    Simplifie l'enveloppe convexe (palette) issue d'un nuage de points
    en fusionnant itérativement des arêtes dont la fusion (via un LP)
    ajoute le moins de volume.

    Paramètres:
      - points: np.array de forme (N, 3) (par exemple, des couleurs dans [0,1] ou [0,255])
      - target_vertices: nombre minimum de sommets désiré dans l'enveloppe simplifiée
      - max_iterations: nombre maximum d'itérations de simplification

    Retourne:
      - Un dictionnaire contenant:
          'vertices': np.array des sommets de l'enveloppe simplifiée
          'faces'   : liste de faces (chaque face est un triplet d'indices)
    """
    # On calcule l'enveloppe convexe initiale à partir des points fournis.
    points = points.reshape(-1, 3)
    initial_hull = ConvexHull(points)
    current_vertices = points[initial_hull.vertices]
    current_faces = np.array(convert_convex_hull_faces(initial_hull))

    # On émet l'enveloppe convexe initiale via SocketIO pour visualisation.
    emit('convex_hull', {'type': 'initial', 'vertices': current_vertices.tolist(), 'faces': current_faces.tolist()})

    iteration = 0
    while iteration < max_iterations and len(current_vertices) > target_vertices:
        # On sauvegarde le nombre de sommets avant la simplification.
        previous_vertex_count = len(current_vertices)
        # On extrait l'ensemble des arêtes de la palette courante.
        edges = get_edges_from_faces(current_faces)
        candidate_collapses = []  # On stocke les tuples (volume_ajoute, edge, nouveau_sommet).

        # On évalue chaque arête candidate pour une fusion.
        for edge in edges:
            candidate = compute_edge_collapse_candidate(edge, current_vertices, current_faces)
            if candidate is not None:
                new_vertex, added_volume = candidate
                candidate_collapses.append((added_volume, edge, new_vertex))

        if not candidate_collapses:
            emit('server_log', {'error': f"Aucune fusion possible à l'itération {iteration}"})
            break

        # On sélectionne la fusion qui minimise le volume ajouté.
        best_candidate = min(candidate_collapses, key=lambda x: x[0])
        best_new_vertex = best_candidate[2]

        # On ajoute le nouveau sommet et on recalcule l'enveloppe convexe.
        updated_vertices = np.vstack((current_vertices, best_new_vertex.reshape(1, 3)))
        new_hull = ConvexHull(updated_vertices)
        current_vertices = updated_vertices[new_hull.vertices]
        current_faces = np.array(convert_convex_hull_faces(new_hull))

        iteration += 1
        if iteration % 10 == 0:
            emit('server_log', {'data': f"Iteration {iteration}: {len(current_vertices)} sommets"})

        # On vérifie si le nombre de sommets n'évolue plus ou atteint un minimum (ex. 4 sommets).
        if len(current_vertices) == previous_vertex_count or len(current_vertices) == 4:
            break

        # On restreint les valeurs des sommets pour qu'elles restent dans l'intervalle [0,1].


        # Si le nombre de sommets est faible, on vérifie la qualité de la simplification via RMSE.
        """if len(current_vertices) <= 20:
            rmse = compute_rmse(points, current_vertices)
            if rmse > 2 / 255:
                break"""

    current_vertices = np.clip(current_vertices, 0, 1)
    return {'vertices': current_vertices, 'faces': current_faces}
