import datetime
from extensions import db

class HarmonizedImage(db.Model):
    """
    Modèle pour enregistrer les images harmonisées.
    Chaque enregistrement contient une image originale et sa version harmonisée.
    """
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    original_image_path = db.Column(db.String(255), nullable=False)
    harmonized_image_path = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.datetime.now(datetime.timezone.utc))
    
    # Relationships
    user = db.relationship('User', backref=db.backref('harmonized_images', lazy=True))
    votes = db.relationship('ImageVote', backref='harmonized_image', lazy=True, cascade="all, delete-orphan")
    
    def __repr__(self):
        return f'<HarmonizedImage {self.id}>'
    
    def to_dict(self):
        """
        On convertit le modèle en dictionnaire pour la sérialisation JSON.
        """
        original_votes = sum(1 for vote in self.votes if vote.vote_for_original)
        harmonized_votes = sum(1 for vote in self.votes if not vote.vote_for_original)
        
        return {
            'image_id': self.id,
            'user': {
                'id': self.user.id,
                'username': self.user.username
            },
            'original_image_url': self.original_image_path,
            'harmonized_image_url': self.harmonized_image_path,
            'original_votes': original_votes,
            'harmonized_votes': harmonized_votes,
            'created_at': self.created_at.isoformat()
        }