"""
Socket.IO server implementation.
"""
import logging
import socketio

from socket_server.event_handlers import (
    handle_connect,
    handle_disconnect,
    handle_upload_image,
    handle_harmonize
)

# Create a Socket.IO server
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins="*", max_http_buffer_size=1024 * 1024 * 6)

# Configure logging
DEBUG = False
if not DEBUG:
    log = logging.getLogger('socketio')
    log.setLevel(logging.ERROR)

# Register event handlers
@sio.event
async def connect(sid, environ):
    await handle_connect(sio, sid, environ)

@sio.event
async def disconnect(sid):
    await handle_disconnect(sio, sid)

@sio.event
async def upload_image(sid, data):
    await handle_upload_image(sio, sid, data)

@sio.event
async def harmonize(sid, data):
    await handle_harmonize(sio, sid, data)

def create_app(socket_id="default"):
    """
    Create an ASGI application for the Socket.IO server.
    
    Args:
        socket_id (str): The socket ID to use in the socketio_path
        
    Returns:
        socketio.ASGIApp: The ASGI application
    """
    return socketio.ASGIApp(
        sio,
        socketio_path=f"/{socket_id}/socket.io"
    )

if __name__ == '__main__':
    import uvicorn
    uvicorn.run("socket_server.server:create_app", host="0.0.0.0", port=5001, factory=True)