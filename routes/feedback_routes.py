import json

from flask import Blueprint, render_template, request, jsonify, session
import uuid
import datetime

img_ids = json.load(open('./ids.json'))

# Blueprint pour les routes liées au feedback
feedback_routes = Blueprint('feedback_routes', __name__)


@feedback_routes.route('/img_ids')
def get_img_ids():
    return jsonify(img_ids)

@feedback_routes.route('/feedback')
def form():
    return render_template('feedback.html')

@feedback_routes.route('/form/feedback', methods=['POST'])
def form_feedback():
    # L'utilisateur nous donne un feedback qui contient l'id de l'image, les deux harmonies présentées et le choix de l'utilisateur
    # On l'enregistre dans un fichier csv
    data = request.get_json()
    img_id = data.get('id')
    harmony1 = data.get('harmonyOption1')
    harmony2 = data.get('harmonyOption2')
    choice = data.get('harmonyChosen')

    # On vérifie que toutes les données sont présentes
    if not img_id or not harmony1 or not harmony2 or not choice:
        return jsonify({'success': False, 'message': 'Données manquantes'}), 400

    # On attribue un ID utilisateur unique si ce n'est pas déjà fait
    if 'user_id' not in session:
        session['user_id'] = str(uuid.uuid4())

    user_id = session['user_id']
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # On enregistre dans le fichier CSV avec l'ID utilisateur
    with open('feedback.csv', 'a') as f:
        f.write(f"{timestamp},{user_id},{img_id},{harmony1},{harmony2},{choice}\n")

    return jsonify({'success': True}), 200