import os
import uuid
import imghdr
from flask import Blueprint, request, jsonify, current_app
from werkzeug.utils import secure_filename
from PIL import Image

from extensions import db
from models.harmonized_image import HarmonizedImage
from models.image_vote import ImageVote
from routes.auth import token_required

# Blueprint pour les routes liées aux images
image_routes = Blueprint('image_routes', __name__)

def allowed_file(filename):
    """
    On vérifie si le fichier a une extension autorisée.
    """
    # Vérification que le nom de fichier n'est pas vide et contient une extension
    if not filename or '.' not in filename:
        return False

    # Vérification de l'extension
    extension = filename.rsplit('.', 1)[1].lower()
    return extension in current_app.config['ALLOWED_IMAGE_EXTENSIONS']

def is_valid_image(file_stream):
    """
    Vérifie si le fichier est une image valide en essayant de l'ouvrir avec PIL.
    """
    try:
        # On sauvegarde la position actuelle dans le flux
        position = file_stream.tell()

        # On essaie d'ouvrir l'image avec PIL
        image = Image.open(file_stream)
        image.verify()  # Vérifie que l'image est valide

        # On remet le curseur à sa position initiale
        file_stream.seek(position)
        return True
    except Exception:
        # On remet le curseur à sa position initiale en cas d'erreur
        file_stream.seek(position)
        return False

def save_image(file):
    """
    Enregistre une image dans le dossier de téléchargement et retourne le chemin.
    Effectue plusieurs vérifications de sécurité.
    """
    # Vérifications de base
    if not file or not file.filename:
        return None

    # Vérification de l'extension
    if not allowed_file(file.filename):
        return None

    # Vérification de la taille du fichier
    if file.content_length and file.content_length > current_app.config['MAX_CONTENT_LENGTH']:
        return None

    # Vérification que c'est bien une image
    if not is_valid_image(file.stream):
        return None

    # Nom générique du fichier pour éviter les collisions
    filename = secure_filename(file.filename)
    unique_filename = f"{uuid.uuid4()}_{filename}"

    # On crée le dossier de téléchargement s'il n'existe pas
    upload_folder = current_app.config['UPLOAD_FOLDER']
    os.makedirs(upload_folder, exist_ok=True)

    # On enregistre le fichier
    file_path = os.path.join(upload_folder, unique_filename)
    file.save(file_path)

    # Vérification finale du type de fichier après sauvegarde
    if not imghdr.what(file_path):
        # Si ce n'est pas une image, on supprime le fichier
        os.remove(file_path)
        return None

    # On retourne le chemin relatif pour l'enregistrement dans la base de données
    return os.path.join(current_app.config['UPLOAD_FOLDER'], unique_filename)

@image_routes.route('/images/upload', methods=['POST'])
@token_required
def upload_image(user):
    """
    Télécharge une image originale et une image harmonisée.
    """
    # On vérifie si les deux fichiers sont présents dans la requête
    if 'original' not in request.files or 'harmonized' not in request.files:
        return jsonify({'error': 'Les deux images sont requises', 'error_code': 'MISSING_IMAGES'}), 400

    original_file = request.files['original']
    harmonized_file = request.files['harmonized']

    # On vérifie si les fichiers ont des extensions autorisées
    if not allowed_file(original_file.filename) or not allowed_file(harmonized_file.filename):
        return jsonify({'error': 'Extensions de fichiers non autorisées', 'error_code': 'INVALID_FILE_TYPE'}), 400

    # On enregistre les fichiers
    original_path = save_image(original_file)
    harmonized_path = save_image(harmonized_file)

    if not original_path or not harmonized_path:
        return jsonify({'error': 'Erreur lors de l\'enregistrement des fichiers', 'error_code': 'FILE_SAVE_ERROR'}), 500

    # On crée un nouvel enregistrement dans la base de données
    new_image = HarmonizedImage(
        user_id=user.id,
        original_image_path=original_path,
        harmonized_image_path=harmonized_path
    )

    try:
        # On enregistre l'image dans la base de données
        db.session.add(new_image)
        db.session.commit()
        return jsonify({'message': 'Image téléchargée avec succès', 'image_id': new_image.id}), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e), 'error_code': 'DATABASE_ERROR'}), 500

@image_routes.route('/images', methods=['GET'])
@token_required
def get_images(user):
    """
    Retourne une liste de 100 images harmonisées avec les votes.
    """
    # On récupère les 100 dernières images harmonisées
    images = HarmonizedImage.query.order_by(HarmonizedImage.created_at.desc()).limit(100).all()

    # On convertit les images en dictionnaires pour la sérialisation JSON
    images_data = []
    for image in images:
        image_dict = image.to_dict()

        # Si l'utilisateur a voté, on ajoute le vote à l'image
        if user:
            user_vote = ImageVote.query.filter_by(
                user_id=user.id,
                harmonized_image_id=image.id
            ).first()

            if user_vote:
                image_dict['user_vote'] = 'original' if user_vote.vote_for_original else 'harmonized'
            else:
                image_dict['user_vote'] = None
        else:
            image_dict['user_vote'] = None

        images_data.append(image_dict)

    return jsonify(images_data), 200

@image_routes.route('/images/<int:image_id>/vote', methods=['POST'])
@token_required
def vote_image(user, image_id):
    """
    Vote pour la version originale ou harmonisée d'une image.
    """
    data = request.get_json()

    if not data or 'vote_for_original' not in data:
        return jsonify({'error': 'Données manquantes', 'error_code': 'MISSING_DATA'}), 400

    vote_for_original = data['vote_for_original']

    # On vérifie que l'image existe
    image = HarmonizedImage.query.get(image_id)
    if not image:
        return jsonify({'error': 'Image non trouvée', 'error_code': 'IMAGE_NOT_FOUND'}), 404

    # On vérifie que l'utilisateur n'a pas déjà voté pour cette image
    existing_vote = ImageVote.query.filter_by(
        user_id=user.id,
        harmonized_image_id=image_id
    ).first()

    try:
        if existing_vote:
            # On met à jour le vote existant
            existing_vote.vote_for_original = vote_for_original
        else:
            # Sinon, on crée un nouveau vote
            new_vote = ImageVote(
                user_id=user.id,
                harmonized_image_id=image_id,
                vote_for_original=vote_for_original
            )
            db.session.add(new_vote)

        db.session.commit()
        return jsonify({'message': 'Vote enregistré avec succès'}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e), 'error_code': 'DATABASE_ERROR'}), 500
