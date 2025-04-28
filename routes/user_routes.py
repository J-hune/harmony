from flask import Blueprint, request, jsonify
import jwt
import datetime

from config import Config
from models.user import User
from extensions import db
from routes.auth import token_required

# Blueprint pour les routes liées à l'utilisateur
user_routes = Blueprint('user_routes', __name__)

# Générer un token JWT
def generate_auth_token(user_id, expiration=3600):
    """
    Génère un token d'authentification JWT.
    :param user_id: L'ID de l'utilisateur
    :param expiration: La durée d'expiration du token en secondes (par défaut 1 heure)
    :return: Le token JWT
    """
    payload = {
        'sub': user_id,  # Identifiant de l'utilisateur
        'iat': datetime.datetime.now(datetime.timezone.utc),  # Date de création
        'exp': datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=expiration)  # Date d'expiration
    }
    return jwt.encode(payload, Config.SECRET_KEY, algorithm='HS256')

@user_routes.route('/user_list')
def user_profile():
    # On récupère la liste des utilisateurs
    users = User.query.all()

    # On return un json avec les utilisateurs sans template
    users_data = [{'id': user.id, 'email': user.email, 'username': user.username} for user in users]
    return jsonify(users_data)


@user_routes.route('/add_user', methods=['POST'])
def add_user():
    # On récupère les données envoyées dans la requête POST
    data = request.get_json()

    # On vérifie que toutes les données obligatoires sont présentes
    if not data or not data.get('email') or not data.get('username') or not data.get('password'):
        return jsonify({'error': 'Données manquantes', 'error_code': 'MISSING_DATA'}), 400

    email = data.get('email')
    username = data.get('username')
    password = data.get('password')

    # Vérification si l'email est déjà utilisé
    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'L\'email est déjà utilisé', 'error_code': 'EMAIL_ALREADY_USED'}), 400

    # Création d'un nouvel utilisateur
    new_user = User(email=email, username=username)
    new_user.set_password(password)

    try:
        # Sauvegarde de l'utilisateur dans la base de données
        db.session.add(new_user)
        db.session.commit()
        return jsonify({'message': 'Utilisateur créé avec succès', 'user_id': new_user.id}), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e), 'error_code': 'DATABASE_ERROR'}), 500

@user_routes.route('/login', methods=['POST'])
def login():
    data = request.get_json()

    if not data or not data.get('email') or not data.get('password'):
        return jsonify({'error': 'Données manquantes'}), 400

    email = data.get('email')
    password = data.get('password')

    # On vérifie si l'utilisateur existe dans la base de données
    user = User.query.filter_by(email=email).first()

    # On vérifie si l'utilisateur existe et si le mot de passe est correct
    if not user or not user.check_password(password):  # Vérifie si le mot de passe correspond
        return jsonify({'error': 'Email ou mot de passe incorrect', 'error_code': 'INVALID_CREDENTIALS'}), 401

    # On génère un token JWT pour l'utilisateur
    token = generate_auth_token(str(user.id), expiration=3600 * 24 * 7)  # 7 jours d'expiration

    # Retourner seulement le jeton et l'ID utilisateur
    return jsonify({
        'message': 'Connexion réussie',
        'user_id': user.id,
        'token': token
    }), 200

@user_routes.route('/profile', methods=['GET'])
@token_required
def profile(user):
    return jsonify({'id': user.id, 'email': user.email, 'username': user.username}), 200

@user_routes.route('/delete_user', methods=['DELETE'])
@token_required
def delete_user(user):
    try:
        # Suppression de l'utilisateur de la base de données
        db.session.delete(user)
        db.session.commit()
        return jsonify({'message': 'Utilisateur supprimé avec succès'}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e), 'error_code': 'DATABASE_ERROR'}), 500
