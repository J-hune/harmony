import logging
import os

from flask import Flask, render_template, jsonify

from config import Config
from extensions import db
from routes.feedback_routes import feedback_routes
from routes.image_routes import image_routes
from routes.user_routes import user_routes


# Socket server configuration
def get_socket_config():
    web_port = int(os.environ.get('WEB_PORT', 5000))
    socket_count = int(os.environ.get('SOCKET_COUNT', 2))
    socket_ports = [web_port + i for i in range(1, socket_count + 1)]
    return web_port, socket_ports


# Load balancer for socket servers
class SocketLoadBalancer:
    def __init__(self, socket_ports):
        self.socket_ports = socket_ports
        self.counter = 0

    def get_next_socket(self):
        socket_port = self.socket_ports[self.counter % len(self.socket_ports)]
        socket_id = self.counter % len(self.socket_ports) + 1
        self.counter += 1
        return socket_id, socket_port


# Create Flask application
def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    # Initialize database
    db.init_app(app)
    with app.app_context():
        db.create_all()

    # Configure logging
    if not os.environ.get('DEBUG'):
        log = logging.getLogger('werkzeug')
        log.setLevel(logging.ERROR)

    # Register blueprints for routes
    app.register_blueprint(user_routes)
    app.register_blueprint(feedback_routes)
    app.register_blueprint(image_routes)

    # Get socket configuration
    web_port, socket_ports = get_socket_config()
    load_balancer = SocketLoadBalancer(socket_ports)

    @app.route('/')
    def index():
        return render_template('index.html')

    @app.route('/app')
    def harmonize():
        return render_template('app.html')

    @app.errorhandler(404)
    def page_not_found(e):
        return render_template('index.html'), 404

    @app.route('/get_socket_id')
    def get_socket_id():
        socket_id, socket_port = load_balancer.get_next_socket()

        if not os.environ.get('DEBUG'):
            return jsonify({'socket_id': socket_id})
        else:
            return jsonify({'socket_port': socket_port})

    return app


if __name__ == '__main__':
    # Get socket configuration
    web_port, socket_ports = get_socket_config()

    # Create and run the Flask application
    app = create_app()
    print("Starting web server on port", web_port)
    app.run(port=web_port)