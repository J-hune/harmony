"""
Socket.IO event handlers for the socket server.
"""
import asyncio
import base64
import cv2
import numpy as np

from palette_simplification import simplify_convex_palette
from palette_harmonization import harmonize_palette
from image_decomposition import extract_rgbxy_weights
from socket_server.utils import client_disconnected, relay_messages


async def handle_connect(sio, sid, environ):
    """
    Handle client connection event.
    
    Args:
        sio: The Socket.IO server instance
        sid: The session ID of the connected client
        environ: The WSGI environment
    """
    print(f"Client connected: {sid}")
    await sio.emit('server_response', {'data': 'Connected to socket server'}, room=sid)


async def handle_disconnect(sio, sid):
    """
    Handle client disconnection event.
    
    Args:
        sio: The Socket.IO server instance
        sid: The session ID of the disconnected client
    """
    print(f"Client disconnected: {sid}")


async def handle_upload_image(sio, sid, data):
    """
    Handle image upload event.
    
    Args:
        sio: The Socket.IO server instance
        sid: The session ID of the client
        data: The data containing the image
    """
    await sio.emit('thinking', {'thinking': True}, room=sid)
    img_data = data.get('image_data')
    if not img_data:
        await sio.emit('error', {'message': 'No image data provided'}, room=sid)
        return

    # Remove header if present (e.g., "data:image/png;base64,")
    try:
        header, encoded = img_data.split(',', 1)
    except Exception:
        await sio.emit('error', {'message': "Invalid image data"}, room=sid)
        return

    # Check if the user is connected
    if await client_disconnected(sio, sid):
        return

    try:
        img_bytes = base64.b64decode(encoded)
    except Exception:
        await sio.emit('error', {'message': "Base64 decoding error"}, room=sid)
        return

    # Convert to numpy array and decode with OpenCV
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img is None:
        await sio.emit('server_response', {'error': "Invalid image data", 'reset': True}, room=sid)
        return

    # Check if the image is not in black and white
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray_3ch = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    if np.array_equal(img, gray_3ch):
        await sio.emit('server_response', {'error': "The image must be in color", 'reset': True}, room=sid)
        return

    # Check if the user is connected
    if await client_disconnected(sio, sid):
        return

    message_queue = asyncio.Queue()
    relay_task = asyncio.create_task(relay_messages(message_queue, sio, sid))

    # Processing: convert to RGB and extract normalized pixels
    pixels = cv2.cvtColor(img, cv2.COLOR_BGR2RGB) / 255.0

    # Calculate simplified palette - ! Long operation
    palette = await asyncio.to_thread(simplify_convex_palette, message_queue, pixels, 6)

    if palette is None:
        await message_queue.put(None)
        await relay_task
        return

    # Check if the user is connected
    if await client_disconnected(sio, sid):
        await message_queue.put(None)
        await relay_task
        return

    vertices = palette['vertices']
    faces = palette['faces']
    await sio.emit('convex_hull', {'type': 'simplified', 'vertices': vertices.tolist(), 'faces': faces.tolist()}, room=sid)

    # Decompose the image into weighted layers according to the color palette - ! Long operation
    await asyncio.to_thread(extract_rgbxy_weights, message_queue, vertices, pixels)
    await sio.emit('thinking', {'thinking': False}, room=sid)

    await message_queue.put(None)
    await relay_task


async def handle_harmonize(sio, sid, data):
    """
    Handle palette harmonization event.
    
    Args:
        sio: The Socket.IO server instance
        sid: The session ID of the client
        data: The data containing the palette to harmonize
    """
    await sio.emit('thinking', {'thinking': True}, room=sid)
    palette = data.get('palette')
    if not palette:
        await sio.emit('error', {'message': 'No palette provided'}, room=sid)
        return

    # Harmonize the palette
    harmonized = harmonize_palette(palette)
    await sio.emit('harmonized', harmonized, room=sid)
    await sio.emit('thinking', {'thinking': False}, room=sid)