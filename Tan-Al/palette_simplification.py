import cvxopt
import cvxopt.solvers
import numpy as np
from flask_socketio import emit
from scipy.spatial import ConvexHull, Delaunay, cKDTree

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
    tree = cKDTree(hull_points)
    min_distances, _ = tree.query(points)
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
    # On calcule la normale du triangle et on retourne le volume absolu.
    normal = np.cross(triangle[1] - triangle[0], triangle[2] - triangle[0])
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


def compute_edge_collapse_candidate(edge, vertices, faces, vertex_face_dict, face_normals, face_offsets):
    """
    Calcule le point candidat pour la fusion d'une arête donnée en résolvant
    un problème d'optimisation linéaire (LP), en utilisant les normales pré-calculées.
    """
    v1, v2 = edge
    faces_v1 = vertex_face_dict[v1]
    faces_v2 = vertex_face_dict[v2]
    combined_face_indices = list(set(faces_v1) | set(faces_v2))

    related_triangles = []
    A_list = []
    b_list = []
    cost_vector = np.zeros(3)

    # On construit le problème linéaire à partir des faces adjacentes.
    for face_idx in combined_face_indices:
        face_indices = faces[face_idx]
        triangle = vertices[face_indices]
        related_triangles.append(triangle)
        normal = face_normals[face_idx]
        if np.linalg.norm(normal) == 0:
            continue
        A_list.append(normal)
        b_list.append(face_offsets[face_idx])
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


def simplify_convex_palette(points, target_vertices=10, max_iterations=500):
    """
    Simplifie l'enveloppe convexe issue d'un nuage de points en fusionnant itérativement des arêtes
    dont la fusion (via un LP) ajoute le moins de volume.
    """
    points = points.reshape(-1, 3)
    initial_hull = ConvexHull(points)
    current_vertices = points[initial_hull.vertices]
    current_faces = np.array(convert_convex_hull_faces(initial_hull))

    # On émet l'enveloppe convexe initiale via SocketIO pour visualisation.
    emit('convex_hull', {'type': 'initial', 'vertices': current_vertices.tolist(), 'faces': current_faces.tolist()})

    iteration = 0
    while iteration < max_iterations and len(current_vertices) > target_vertices:
        previous_vertex_count = len(current_vertices)

        # Pré-calcul des voisins de faces pour chaque sommet
        vertex_face_dict = {i: [] for i in range(len(current_vertices))}
        for i, face in enumerate(current_faces):
            for v in face:
                vertex_face_dict[v].append(i)

        # Pré-calcul des normales et offsets pour chaque face
        face_normals = []
        face_offsets = []
        for face in current_faces:
            p0 = current_vertices[face[0]]
            p1 = current_vertices[face[1]]
            p2 = current_vertices[face[2]]
            normal = np.cross(p1 - p0, p2 - p0)
            norm_val = np.linalg.norm(normal)
            if norm_val != 0:
                normal = normal / norm_val
            else:
                normal = np.zeros(3)
            face_normals.append(normal)
            face_offsets.append(np.dot(normal, p0))
        face_normals = np.array(face_normals)
        face_offsets = np.array(face_offsets)

        edges = get_edges_from_faces(current_faces)
        candidate_collapses = []

        # On évalue chaque arête candidate pour une fusion.
        for edge in edges:
            candidate = compute_edge_collapse_candidate(edge, current_vertices, current_faces,
                                                        vertex_face_dict, face_normals, face_offsets)
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

        # Si le nombre de sommets est faible, on vérifie la qualité de la simplification via RMSE.
        if len(current_vertices) <= 20:
            test_vertices = np.clip(current_vertices, 0, 1)
            rmse = compute_rmse(points, test_vertices)
            if rmse > 4 / 255:
                break

    current_vertices = np.clip(current_vertices, 0, 1)
    return {'vertices': current_vertices, 'faces': current_faces}
