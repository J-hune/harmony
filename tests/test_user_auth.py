import unittest
import json
import os
import sys

# Add the parent directory to the path so we can import from the main application
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask
from extensions import db
from models.user import User
from routes.user_routes import user_routes
from config import Config

class TestUserAuth(unittest.TestCase):
    def setUp(self):
        """Set up test environment before each test"""
        # Create a test Flask app
        self.app = Flask(__name__)
        
        # Configure the app for testing
        self.app.config['TESTING'] = True
        self.app.config['SECRET_KEY'] = Config.SECRET_KEY
        self.app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'  # Use in-memory SQLite for testing
        self.app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
        
        # Register the user routes blueprint
        self.app.register_blueprint(user_routes)
        
        # Initialize the database
        db.init_app(self.app)
        
        # Create a test client
        self.client = self.app.test_client()
        
        # Create all tables in the test database
        with self.app.app_context():
            db.create_all()
        
        # Test user data
        self.test_user = {
            'email': 'test@example.com',
            'username': 'testuser',
            'password': 'password123'
        }
        
        # Store the token for authenticated requests
        self.token = None
    
    def tearDown(self):
        """Clean up after each test"""
        with self.app.app_context():
            db.session.remove()
            db.drop_all()
    
    def test_user_creation(self):
        """Test user creation endpoint"""
        # Send a POST request to create a user
        response = self.client.post(
            '/add_user',
            data=json.dumps(self.test_user),
            content_type='application/json'
        )
        
        # Check if the response is successful
        self.assertEqual(response.status_code, 201)
        
        # Check if the user was created in the database
        with self.app.app_context():
            user = User.query.filter_by(email=self.test_user['email']).first()
            self.assertIsNotNone(user)
            self.assertEqual(user.username, self.test_user['username'])
    
    def test_login_success(self):
        """Test login with correct credentials"""
        # First create a user
        self.client.post(
            '/add_user',
            data=json.dumps(self.test_user),
            content_type='application/json'
        )
        
        # Try to login with correct credentials
        response = self.client.post(
            '/login',
            data=json.dumps({
                'email': self.test_user['email'],
                'password': self.test_user['password']
            }),
            content_type='application/json'
        )
        
        # Check if login was successful
        self.assertEqual(response.status_code, 200)
        
        # Store the token for later tests
        data = json.loads(response.data)
        self.assertIn('token', data)
        self.token = data['token']
    
    def test_login_failure(self):
        """Test login with incorrect credentials"""
        # First create a user
        self.client.post(
            '/add_user',
            data=json.dumps(self.test_user),
            content_type='application/json'
        )
        
        # Try to login with incorrect password
        response = self.client.post(
            '/login',
            data=json.dumps({
                'email': self.test_user['email'],
                'password': 'wrong_password'
            }),
            content_type='application/json'
        )
        
        # Check if login failed
        self.assertEqual(response.status_code, 401)
    
    def test_profile_with_token(self):
        """Test profile retrieval with a valid token"""
        # First create a user and login to get a token
        self.client.post(
            '/add_user',
            data=json.dumps(self.test_user),
            content_type='application/json'
        )
        
        login_response = self.client.post(
            '/login',
            data=json.dumps({
                'email': self.test_user['email'],
                'password': self.test_user['password']
            }),
            content_type='application/json'
        )
        
        token = json.loads(login_response.data)['token']
        
        # Try to access the profile with the token
        response = self.client.get(
            '/profile',
            headers={'Authorization': f'Bearer {token}'}
        )
        
        # Check if profile retrieval was successful
        self.assertEqual(response.status_code, 200)
        
        # Check if the profile data is correct
        data = json.loads(response.data)
        self.assertEqual(data['email'], self.test_user['email'])
        self.assertEqual(data['username'], self.test_user['username'])
    
    def test_delete_user(self):
        """Test user deletion"""
        # First create a user and login to get a token
        self.client.post(
            '/add_user',
            data=json.dumps(self.test_user),
            content_type='application/json'
        )
        
        login_response = self.client.post(
            '/login',
            data=json.dumps({
                'email': self.test_user['email'],
                'password': self.test_user['password']
            }),
            content_type='application/json'
        )
        
        token = json.loads(login_response.data)['token']
        
        # Try to delete the user with the token
        response = self.client.delete(
            '/delete_user',
            headers={'Authorization': f'Bearer {token}'}
        )
        
        # Check if user deletion was successful
        self.assertEqual(response.status_code, 200)
        
        # Check if the user was actually deleted from the database
        with self.app.app_context():
            user = User.query.filter_by(email=self.test_user['email']).first()
            self.assertIsNone(user)

if __name__ == '__main__':
    unittest.main()