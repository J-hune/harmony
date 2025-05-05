"""
Utility functions for the socket server.
"""
import asyncio


async def client_disconnected(sio, sid):
    """
    Check if the client is connected.
    
    Args:
        sio: The Socket.IO server instance
        sid: The session ID to check
        
    Returns:
        bool: True if the client is disconnected, False otherwise
    """
    connected_sids = list(sio.manager.rooms.get('/', {}).keys())

    # Check if the sid is in the list of connected sids, if not, emit an error and return False
    if sid not in connected_sids:
        await sio.emit('error', {'message': 'Client not connected'}, room=sid)
        return True
    return False


async def relay_messages(queue, sio, sid):
    """
    Relay messages from a queue to a socket.io client.
    
    Args:
        queue: The asyncio Queue containing messages to relay
        sio: The Socket.IO server instance
        sid: The session ID to send messages to
    """
    while True:
        event = await queue.get()
        if event is None:
            break  # stop signal
        event_name, data = event
        await sio.emit(event_name, data, room=sid)