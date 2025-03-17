import math

import numpy as np
from matplotlib import pyplot as plt


# -------------------------------
# CONVERSION RGB ↔ LCh
# -------------------------------
def srgb_to_linear(c):
    # On convertit un canal sRGB (0-1) en linéaire.
    if c <= 0.04045:
        return c / 12.92
    else:
        return ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(c):
    # On convertit un canal linéaire en sRGB (0-1).
    if c <= 0.0031308:
        return 12.92 * c
    else:
        return 1.055 * (c ** (1 / 2.4)) - 0.055


def rgb_to_xyz(rgb):
    # On convertit une couleur RGB (valeurs dans [0,1]) en XYZ.
    r, g, b = rgb
    r_lin = srgb_to_linear(r)
    g_lin = srgb_to_linear(g)
    b_lin = srgb_to_linear(b)
    X = r_lin * 0.4124564 + g_lin * 0.3575761 + b_lin * 0.1804375
    Y = r_lin * 0.2126729 + g_lin * 0.7151522 + b_lin * 0.0721750
    Z = r_lin * 0.0193339 + g_lin * 0.1191920 + b_lin * 0.9503041
    return (X * 100, Y * 100, Z * 100)


def xyz_to_lab(xyz):
    # On convertit XYZ en Lab (point blanc D65).
    X, Y, Z = xyz
    Xn, Yn, Zn = 95.047, 100.0, 108.883
    delta = 6 / 29

    def f(t):
        if t > delta ** 3:
            return t ** (1 / 3)
        else:
            return t / (3 * delta ** 2) + 4 / 29

    fx = f(X / Xn)
    fy = f(Y / Yn)
    fz = f(Z / Zn)
    L = 116 * fy - 16
    a = 500 * (fx - fy)
    b = 200 * (fy - fz)
    return (L, a, b)


def lab_to_xyz(lab):
    # On convertit Lab en XYZ (point blanc D65).
    L, a, b = lab
    Yn = 100.0;
    Xn = 95.047;
    Zn = 108.883
    fy = (L + 16) / 116
    fx = fy + (a / 500)
    fz = fy - (b / 200)
    delta = 6 / 29

    def f_inv(f):
        if f > delta:
            return f ** 3
        else:
            return 3 * delta ** 2 * (f - 4 / 29)

    X = Xn * f_inv(fx)
    Y = Yn * f_inv(fy)
    Z = Zn * f_inv(fz)
    return (X, Y, Z)


def xyz_to_rgb(xyz):
    # On convertit XYZ en RGB (0-1).
    X, Y, Z = xyz
    X /= 100;
    Y /= 100;
    Z /= 100
    r_lin = X * 3.2404542 + Y * -1.5371385 + Z * -0.4985314
    g_lin = X * -0.9692660 + Y * 1.8760108 + Z * 0.0415560
    b_lin = X * 0.0556434 + Y * -0.2040259 + Z * 1.0572252
    r = linear_to_srgb(r_lin)
    g = linear_to_srgb(g_lin)
    b = linear_to_srgb(b_lin)
    return (max(0, min(1, r)), max(0, min(1, g)), max(0, min(1, b)))


def lab_to_lch(lab):
    # On convertit Lab en LCh.
    L, a, b = lab
    C = math.sqrt(a * a + b * b)
    h = math.degrees(math.atan2(b, a))
    if h < 0:
        h += 360
    return (L, C, h)


def lch_to_lab(lch):
    # On convertit LCh en Lab.
    L, C, h = lch
    h_rad = math.radians(h)
    a = C * math.cos(h_rad)
    b = C * math.sin(h_rad)
    return (L, a, b)


def rgb_to_lch(rgb):
    # On convertit RGB en LCh via XYZ et Lab.
    xyz = rgb_to_xyz(rgb)
    lab = xyz_to_lab(xyz)
    return lab_to_lch(lab)


def lch_to_rgb(lch):
    # On convertit LCh en RGB.
    lab = lch_to_lab(lch)
    xyz = lab_to_xyz(lab)
    return xyz_to_rgb(xyz)


def angle_diff(a, b):
    # On calcule la différence angulaire minimale entre deux angles (en degrés).
    diff = abs(a - b) % 360
    if diff > 180:
        diff = 360 - diff
    return diff


# -------------------------------
# PLOTTING
# -------------------------------
def plot_palette_on_circle(palette, title="Palette harmonisée"):
    """
    Affiche la palette de couleurs sur un cercle polaire.

    Paramètres :
      — palette : liste de couleurs (L, C, hue) en LCh
      — title : titre du plot (optionnel)

    On convertit chaque couleur en LCh pour extraire la teinte (hue)
    et on trace un point sur un cercle à l'angle correspondant.
    """
    # Création d'une figure avec un axe polaire
    fig, ax = plt.subplots(subplot_kw={'projection': 'polar'}, figsize=(6, 6))
    ax.set_ylim(0, 1.5)

    palette_debug = []
    # Pour chaque couleur de la palette
    for col in palette:
        L, C, hue = col

        hue_rad = np.deg2rad(hue)  # conversion en radians pour le plot polaire
        palette_debug.append(hue)
        r = C / 100  # rayon proportionnel à la chroma (normalisé entre 0 et 1)

        # On trace le point avec la couleur correspondante
        color = lch_to_rgb((L, C, hue))
        ax.scatter(hue_rad, r, color=color, s=200, edgecolors='black', zorder=3)
        ax.text(hue_rad, r + 0.2, f"{int(hue)}°", horizontalalignment='center', verticalalignment='center', fontsize=10)

    print(palette_debug, title)
    # Réglages des axes
    ticks = np.deg2rad(np.arange(0, 360, 30))
    ax.set_xticks(ticks)
    ax.set_xticklabels([f"{i}°" for i in range(0, 360, 30)])
    ax.set_yticklabels([])  # on masque l'échelle radiale
    ax.set_title(title, fontsize=14)
    plt.show()


# -------------------------------
# TEMPLATES DE HARMONISATION
# -------------------------------
# Pour les templates à un degré de liberté, on définit des fonctions lambda.
template_monochrome = lambda alpha: [alpha % 360]
template_complementary = lambda alpha: [alpha % 360, (alpha + 180) % 360]
template_triad = lambda alpha: [alpha % 360, (alpha + 120) % 360, (alpha + 240) % 360]
template_square = lambda alpha: [alpha % 360, (alpha + 90) % 360, (alpha + 180) % 360, (alpha + 270) % 360]
template_analogous = lambda alpha: [((alpha - 30) % 360), alpha % 360, ((alpha + 30) % 360)]


# Pour single split et double split, on inclut un second paramètre α₂.
def template_single_split(alpha1, alpha2):
    # On définit single split comme : [α₁, α₁ + (180 - α₂), α₁ + (180 + α₂)]
    return [alpha1 % 360, (alpha1 + (180 - alpha2)) % 360, (alpha1 + (180 + alpha2)) % 360]

def template_double_split(alpha1, alpha2):
    # On définit double split comme : [α₁, α₁ + α₂, α₁ + 180, α₁ + 180 + α₂]
    return [alpha1 % 360, (alpha1 + alpha2) % 360, (alpha1 + 180) % 360, (alpha1 + 180 + alpha2) % 360]


# -------------------------------
# FONCTIONS DE RECHERCHE DE PARAMÈTRES OPTIMAUX
# -------------------------------
def best_fit_template_1d(lch_palette, template_func):
    # On recherche l'angle optimal (α) pour un template à 1 degré de liberté.
    best_alpha = 0
    best_D = float('inf')
    n = len(lch_palette)
    for alpha in range(360):
        axes = template_func(alpha)
        total = 0.0
        for (L, C, h) in lch_palette:
            # On trouve l'écart minimal entre la teinte h et l'un des axes
            d = min(angle_diff(h, ax) for ax in axes)
            total += L * C * d
        D = total / n
        if D < best_D:
            best_D = D
            best_alpha = alpha
    return (best_alpha, best_D)


def best_fit_template_2d(lch_palette, template_func):
    # On recherche les angles optimaux (α₁ et α₂) pour un template à 2 degrés de liberté.
    best_alpha1 = 0
    best_alpha2 = 0
    best_D = float('inf')
    n = len(lch_palette)
    for alpha1 in range(360):
        for alpha2 in range(-30, 30):  # α₂ de -15 à 15 degrés
            axes = template_func(alpha1, alpha2)
            total = 0.0
            for (L, C, h) in lch_palette:
                d = min(angle_diff(h, ax) for ax in axes)
                total += L * C * d
            D = total / n
            if D < best_D:
                best_D = D
                best_alpha1 = alpha1
                best_alpha2 = alpha2
    return (best_alpha1, best_alpha2, best_D)


def harmonize_lch_palette(lch_palette, template_func, params):
    # On harmonise la palette en forçant chaque couleur à adopter la teinte de l'axe le plus proche.
    # params peut être un tuple (alpha) ou (alpha1, alpha2)
    if isinstance(params, tuple) and len(params) == 2:
        alpha1, alpha2 = params
        axes = template_func(alpha1, alpha2)
    else:
        alpha = params if not isinstance(params, tuple) else params[0]
        axes = template_func(alpha)
    new_palette = []
    for (L, C, h) in lch_palette:
        # On choisit l'axe le plus proche
        best_ax = min(axes, key=lambda ax: angle_diff(h, ax))
        new_palette.append((L, C, best_ax))
    return new_palette


# -------------------------------
# FONCTION PRINCIPALE D'HARMONISATION
# -------------------------------
def harmonize_palette(palette, plot=False):
    """
    Implémente la partie harmonisation 4.

    Paramètres:
      - palette: tableau de tableaux de 3 floats (RGB dans [0,1])
        représentant les couleurs d'une palette.

    Retourne:
      - Un dictionnaire où chaque clé est le type d'harmonisation (parmi
        "monochrome", "complementary", "triad", "square", "analogous",
        "single split" et "double split") et chaque valeur est un dictionnaire contenant :
          - "palette" : la nouvelle palette harmonisée (en RGB dans [0,1])
          - "taux"   : le taux d'optimalité, défini ici comme 1/(1 + distance moyenne)

    On convertit d'abord la palette de RGB vers LCh.
    Pour les templates à 1 degré de liberté, on effectue une recherche brute
    sur α ∈ [0, 360). Pour "single split" et "double split", on recherche sur
    (α₁, α₂) avec α₁ ∈ [0,360) et α₂ ∈ [–15,15].
    On harmonise ensuite la palette en forçant chaque couleur à adopter la teinte
    de l'axe le plus proche, puis on reconvertit en RGB.
    """
    # On définit le dictionnaire des templates et un indicateur si le template est à 2D.
    templates = {
        "monochromatic-harmony": (template_monochrome, False),
        "complementary-harmony": (template_complementary, False),
        "triadic-harmony": (template_triad, False),
        "square-harmony": (template_square, False),
        "analogous-harmony": (template_analogous, False),
        "split-harmony": (template_single_split, True),
        "double-split-harmony": (template_double_split, True)
    }

    # On normalise la palette [255,255,255] → [1,1,1]
    palette_float = [[r / 255, g / 255, b / 255] for r, g, b in palette]
    print(palette_float)

    # On convertit la palette d'entrée de RGB vers LCh.
    lch_palette = [rgb_to_lch(col) for col in palette_float]

    # On plot la palette d'entrée
    if plot:
        plot_palette_on_circle(lch_palette)

    result = {}
    # Pour chaque type d'harmonisation, on recherche les paramètres optimaux.
    for template_name, (template_func, is2d) in templates.items():
        if is2d:
            best_alpha1, best_alpha2, best_D = best_fit_template_2d(lch_palette, template_func)
            params = (best_alpha1, best_alpha2)
        else:
            best_alpha, best_D = best_fit_template_1d(lch_palette, template_func)
            params = best_alpha
        # On harmonise la palette en LCh.
        harmonized_lch = harmonize_lch_palette(lch_palette, template_func, params)

        # On plot la palette harmonisée
        if plot:
            plot_palette_on_circle(harmonized_lch, title=template_name)

        # On reconvertit la palette harmonisée en RGB.
        new_palette = [lch_to_rgb(col) for col in harmonized_lch]

        # On multiplie par 255 pour obtenir des valeurs [0,255]
        new_palette = [[round(r * 255), round(g * 255), round(b * 255)] for r, g, b in new_palette]

        # Le taux d'optimalité est défini comme 1/(1 + distance moyenne).
        taux = 1 / (1 + best_D)
        result[template_name] = {"palette": new_palette, "taux": taux}
    return result
