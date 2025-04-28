from flask import request, jsonify
import jwt
from functools import wraps

from config import Config
from models.user import User

# Décorateur pour vérifier le token JWT
def token_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = None

        # On vérifie si le token est dans les en-têtes de la requête
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization'] # On enlève le mot "Bearer" du token
            if auth_header.startswith("Bearer "):
                token = auth_header.split(" ")[1]
            else:
                return jsonify({'message': 'Format de token invalide', 'error_code': 'INVALID_TOKEN_FORMAT'}), 403

        if not token:
            return jsonify({'message': 'Token manquant', 'error_code': 'MISSING_TOKEN'}), 403

        try:
            # Décode le token
            data = jwt.decode(token, Config.SECRET_KEY, algorithms=['HS256'])
            user = User.query.get(data['sub'])
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token expiré', 'error_code': 'TOKEN_EXPIRED'}), 403
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Token invalide', 'error_code': 'INVALID_TOKEN'}), 403

        return f(user, *args, **kwargs)

    return decorated_function
