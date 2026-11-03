"""File d'attente des traitements : un nombre borné en cours, les suivants attendent leur tour."""
import asyncio
from collections import OrderedDict


class QueueFullError(Exception):
    """La file d'attente a atteint sa longueur maximale."""


class JobQueue:
    """
    File FIFO limitant le nombre de traitements simultanés.

    `acquire(key)` attend qu'une place se libère (ou lève QueueFullError si trop
    de personnes attendent déjà) ; `release()` libère la place, qui passe
    directement au premier en attente. `on_position(key, position)` est appelé
    à chaque changement de position (1 = prochain servi).
    """

    def __init__(self, slots, max_waiting, on_position=None):
        self.slots = max(1, slots)
        self.max_waiting = max(0, max_waiting)
        self.on_position = on_position
        self.running = 0
        self._waiting = OrderedDict()  # clé -> future, dans l'ordre d'arrivée

    @property
    def waiting(self):
        return len(self._waiting)

    async def acquire(self, key):
        if self.running < self.slots and not self._waiting:
            self.running += 1
            return

        if len(self._waiting) >= self.max_waiting:
            raise QueueFullError()

        future = asyncio.get_running_loop().create_future()
        self._waiting[key] = future
        await self._notify_positions()
        try:
            await future
        except asyncio.CancelledError:
            # Abandon pendant l'attente (déconnexion) : on quitte la file.
            if self._waiting.pop(key, None) is not None:
                await self._notify_positions()
            elif future.done() and not future.cancelled():
                self.release()  # la place venait d'être attribuée : on la rend
            raise

    def release(self):
        """Libère une place : le premier en attente la récupère directement."""
        while self._waiting:
            _, future = self._waiting.popitem(last=False)
            if not future.done():
                future.set_result(None)
                asyncio.get_running_loop().create_task(self._notify_positions())
                return
        self.running = max(0, self.running - 1)

    def cancel(self, key):
        """Retire `key` de la file d'attente (sans effet s'il n'y est pas)."""
        future = self._waiting.get(key)
        if future is not None and not future.done():
            future.cancel()

    async def _notify_positions(self):
        if self.on_position is None:
            return
        for position, key in enumerate(list(self._waiting), start=1):
            await self.on_position(key, position)
