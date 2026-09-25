"""Small cached clients for public geographic services; at most one call/second."""
from __future__ import annotations

import asyncio
import copy
import math
import time

import httpx

from ..config import settings

_locks: dict[str, asyncio.Lock] = {}
_last_call: dict[str, float] = {}
_cache: dict[str, tuple[float, dict | list]] = {}


async def cached_get(service: str, url: str, params: dict, ttl: int = 3600):
    key = repr((url, sorted(params.items())))
    async with _locks.setdefault(service, asyncio.Lock()):
        cached = _cache.get(key)
        if cached and time.monotonic() - cached[0] < ttl:
            return copy.deepcopy(cached[1])
        await asyncio.sleep(max(0, 1.1 - (time.monotonic() - _last_call.get(service, 0))))
        _last_call[service] = time.monotonic()
        async with httpx.AsyncClient(timeout=20, headers={"User-Agent": "DECK01-local-demo/1.0", "Referer": "http://localhost:3000/"}) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
        if len(_cache) >= 256:
            _cache.pop(next(iter(_cache)))
        _cache[key] = (time.monotonic(), data)
        return copy.deepcopy(data)


def distance_m(a, b) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 12742000 * math.asin(min(1, math.sqrt(h)))


async def geocode(location: str) -> tuple[float, float]:
    data = await cached_get("nominatim", settings.nominatim_base_url.rstrip('/') + '/search', {
        "q": location, "format": "jsonv2", "limit": 1,
        "viewbox": "-74.26,40.92,-73.68,40.49", "bounded": 1,
    })
    if not data:
        raise ValueError("Location not found within NYC. Try a street, landmark, or camera name.")
    return float(data[0]['lat']), float(data[0]['lon'])


async def road_route(points: list[tuple[float, float]]) -> dict:
    if not 2 <= len(points) <= 8:
        raise ValueError("Choose between 2 and 8 route points.")
    if any(not (40.49 <= lat <= 40.92 and -74.26 <= lon <= -73.68) for lat, lon in points):
        raise ValueError("Route points must be within NYC.")
    coords = ';'.join(f'{lon:.6f},{lat:.6f}' for lat, lon in points)
    data = await cached_get('osrm', f'{settings.osrm_base_url.rstrip("/")}/route/v1/driving/{coords}', {
        "overview": "full", "geometries": "geojson", "steps": "false",
    })
    if data.get('code') != 'Ok' or not data.get('routes'):
        raise ValueError("No driving route was returned for these stops.")
    route = data['routes'][0]
    geometry = route.get('geometry', {}).get('coordinates', [])
    if len(geometry) < 2 or not all(len(p) == 2 and all(math.isfinite(x) for x in p) for p in geometry):
        raise ValueError("Routing service returned invalid road geometry.")
    if len(route.get('legs', [])) != len(points)-1:
        raise ValueError("Routing service returned an incomplete itinerary.")
    return route
