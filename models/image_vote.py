from extensions import db

class ImageVote(db.Model):
    """
    Model pour enregistrer les votes sur les images harmonisées.
    Chaque enregistrement représente un vote d'un utilisateur pour la version originale ou harmonisée d'une image.
    """
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    harmonized_image_id = db.Column(db.Integer, db.ForeignKey('harmonized_image.id'), nullable=False)
    vote_for_original = db.Column(db.Boolean, nullable=False)  # Vraie si l'utilisateur vote pour la version originale, faux pour la version harmonisée
    
    # Relationships
    user = db.relationship('User', backref=db.backref('image_votes', lazy=True))
    
    # On vérifie que chaque utilisateur ne peut voter qu'une seule fois pour une image donnée
    __table_args__ = (
        db.UniqueConstraint('user_id', 'harmonized_image_id', name='unique_user_image_vote'),
    )
    
    def __repr__(self):
        vote_type = "original" if self.vote_for_original else "harmonized"
        return f'<ImageVote {self.id} by user {self.user_id} for {vote_type} version of image {self.harmonized_image_id}>'