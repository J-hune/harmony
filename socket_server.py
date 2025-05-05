"""
Socket.IO server implementation.

This file is kept for backward compatibility.
The actual implementation has been moved to the socket_server package.
"""

# Re-export from the socket_server package
from socket_server import create_app
from socket_server.server import sio

# For backward compatibility
if __name__ == '__main__':
    import uvicorn
    uvicorn.run("socket_server:create_app", host="0.0.0.0", port=5001, factory=True)
