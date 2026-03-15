# 🪄 Harmonisation d'images  

Ce projet permet l’harmonisation d’images via extraction de palette, décomposition dans l’espace RGBXY et transfert de couleur.  
Il est basé sur l'article scientifique suivant :

📄 **Tan, J., Echevarria, J. I., & Gingold, Y. I. (2018).**  
[*Palette-based image decomposition, harmonization, and color transfer*](https://arxiv.org/pdf/1804.01225)  

<img width="1440" alt="app" src="https://github.com/user-attachments/assets/1f83646a-fa16-4add-9cc8-5d3b4443c281" />

## 🌍 Démo en ligne  

🔗 [Accédez au site web](https://harmony.jhune.dev)  

## 🚀 Installation et exécution  

Clonez le projet et installez les dépendances nécessaires :  

```bash
git clone https://github.com/J-hune/harmony.git
cd harmony
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python main.py
```  

Le [site sera accessible](http://127.0.0.1:5000) sur le port **5000**.

## ⚙️ Variables d'environnement

Les principales variables disponibles dans `.env` sont:

- `HOST`: host d'ecoute Flask/Socket.IO (`127.0.0.1` en local, `0.0.0.0` en container).
- `LOAD_BALANCER_PORT`: port HTTP principal (defaut `5000`).
- `SOCKET_NUMBER`: nombre de serveurs socket lances (`2` par defaut).
- `SOCKET_WORKERS`: nombre de threads pour les traitements lourds websocket.
- `CORS_ALLOWED_ORIGINS`: liste d'origines autorisees separees par des virgules.
- `APP_SECRET_KEY`: secret Flask (obligatoire en production).

## 🐳 Docker

Execution avec Docker Compose:

```bash
cp .env.example .env
docker compose up -d --build
```

L'application expose le web sur `5000` et les sockets sur `5001` et `5002`.
