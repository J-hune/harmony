import cv2
from scipy.spatial import ConvexHull

from convex_hull import palette_simplification
from plot import plot_palette, plot_convex_hull_3d


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
    main()
