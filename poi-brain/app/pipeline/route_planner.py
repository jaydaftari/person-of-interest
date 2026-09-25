"""Turn suggested stops into actual road routes; never disguise straight lines as roads."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from ..schemas import PatrolRoute, PatrolWaypoint, PatrolRouteSolverMeta
from ..state import STATE
from .geo_services import road_route
from .risk_engine import _reasons_for_row
from .solve_cuopt import solve_routes, ROUTE_BUDGET_S

_route_lock = asyncio.Lock()
_cached_at: datetime | None = None
_route_cache: list[PatrolRoute] = []


def stamp() -> str:
    return datetime.now(timezone.utc).isoformat()


async def enrich_route(route: PatrolRoute, budget: float | None = None) -> PatrolRoute:
    route.generatedAt = stamp()
    try:
        data = await road_route([w.latLng for w in route.waypoints])
        # Suggested patrols obey the budget using road travel times, not aerial distance.
        if budget is not None and data['duration'] > budget:
            elapsed, keep = 0.0, 1
            for leg in data['legs']:
                if elapsed + leg['duration'] > budget:
                    break
                elapsed += leg['duration']
                keep += 1
            if keep < 2:
                raise ValueError("No selected stop is reachable within the 30-minute driving budget.")
            route.waypoints = route.waypoints[:keep]
            data = await road_route([w.latLng for w in route.waypoints])
        elapsed = 0.0
        for i, waypoint in enumerate(route.waypoints):
            if i:
                elapsed += data['legs'][i-1]['duration']
            waypoint.etaSeconds = elapsed
        route.geometry = data['geometry']['coordinates']
        route.distanceMeters = data['distance']
        route.durationSeconds = data['duration']
        route.status = 'ready'
        route.totalRiskCovered = round(sum(w.riskScore or 0 for w in route.waypoints[1:]), 3)
    except Exception as err:
        route.status = 'unavailable'
        route.error = f"Road routing unavailable: {str(err)[:180]}"
        route.geometry = []
        route.distanceMeters = None
        route.durationSeconds = None
        for w in route.waypoints:
            w.etaSeconds = None
    return route


async def patrol_routes(force: bool = False) -> list[PatrolRoute]:
    global _cached_at, _route_cache
    async with _route_lock:
        now = datetime.now(timezone.utc)
        ttl = 60 if force or any(r.status == 'unavailable' for r in _route_cache) else 900
        if _route_cache and _cached_at and (now-_cached_at).total_seconds() < ttl:
            return _route_cache
        routes = solve_routes()
        cells = {c.h3Index: c for c in STATE.hex_cells}
        import h3
        for route in routes:
            route.solverMetadata.solverBackend = 'greedy'
            route.waypoints = route.waypoints[:5]
            route.waypoints[0].name = 'Simulated starting point'
            for w in route.waypoints[1:]:
                cell_id = h3.latlng_to_cell(*w.latLng, 9)
                cell = cells.get(cell_id)
                w.name = f'Historical hotspot {cell_id[-6:]}'
                w.h3Cell = cell_id
                if cell:
                    w.riskScore = cell.score
                    w.reasons = _reasons_for_row(cell.contributingFactors)
            await enrich_route(route, ROUTE_BUDGET_S)
        _route_cache = routes
        _cached_at = now
        return routes


async def plan_camera_route(camera_ids: list[str], start_location: str | None = None) -> PatrolRoute:
    from .geo_services import geocode
    ids = list(dict.fromkeys(camera_ids))
    if not 2 <= len(ids) <= 6:
        raise ValueError('Choose 2–6 distinct camera IDs in the desired visiting order.')
    waypoints = []
    if start_location:
        waypoints.append(PatrolWaypoint(latLng=await geocode(start_location), name=start_location, etaSeconds=0))
    for camera_id in ids:
        cam = STATE.cameras.get(camera_id)
        if not cam or not cam.latLng:
            raise ValueError(f'Unknown camera or missing coordinates: {camera_id}')
        risk = STATE.risk_by_camera.get(camera_id)
        waypoints.append(PatrolWaypoint(
            latLng=cam.latLng, cameraId=cam.id, name=cam.name, etaSeconds=0,
            riskScore=risk.score if risk else None,
            reasons=risk.reasons if risk else ['No historical risk coverage'],
        ))
    route = PatrolRoute(unitId='selected-route', waypoints=waypoints, totalRiskCovered=0,
        solverMetadata=PatrolRouteSolverMeta(solveMs=0, objective=0, solverBackend='selected-order'))
    return await enrich_route(route)


async def compare_suggested_routes(metric: str = 'collisions', route_id: str | None = None) -> dict:
    descriptions = {
        'collisions': 'Highest recorded collision count in any visited stop cell (source-relative 365-day window)',
        'shortest_time': 'Lowest estimated driving time, excluding traffic and dwell time',
        'shortest_distance': 'Shortest road distance',
        'historical_rank': 'Highest historical rank among visited stop cells',
    }
    if metric not in descriptions:
        raise ValueError('Unsupported route comparison metric')
    routes = await patrol_routes()
    cells = {cell.h3Index: cell for cell in STATE.hex_cells}
    summaries = []
    for route in routes:
        stops = {w.h3Cell: cells[w.h3Cell] for w in route.waypoints[1:] if w.h3Cell in cells}
        counts = [float(c.contributingFactors['collision_365d']) for c in stops.values() if 'collision_365d' in c.contributingFactors]
        peak = max(counts) if counts else None
        rank = max((c.score for c in stops.values()), default=None)
        value = {'collisions': peak, 'shortest_time': route.durationSeconds,
                 'shortest_distance': route.distanceMeters, 'historical_rank': rank}[metric]
        summaries.append({'routeId':route.unitId,'status':route.status,'value':value,
            'peakStopCollisions':peak,'coveredStopCells':len(counts), 'totalStops':len(route.waypoints)-1,
            'distanceMeters':route.distanceMeters,'durationSeconds':route.durationSeconds})
    eligible = [row for row in summaries if row['status'] == 'ready' and row['value'] is not None]
    eligible.sort(key=lambda row: row['value'], reverse=metric in ('collisions','historical_rank'))
    if route_id:
        chosen = next((r for r in routes if r.unitId == route_id), None)
        if not chosen:
            raise ValueError('Unknown suggested route; use the route IDs returned by this tool.')
    else:
        if not eligible:
            raise ValueError('No routable suggestions with data for this comparison.')
        chosen = next(r for r in routes if r.unitId == eligible[0]['routeId'])
    tied = [r['routeId'] for r in eligible if r['value'] == eligible[0]['value']] if eligible else []
    return {'route':chosen.model_dump(), 'routeComparison': {
        'metric':metric,'description':descriptions[metric],'rankedRoutes':eligible,
        'unavailableRoutes':[r for r in summaries if r not in eligible],
        'selectedRouteId':chosen.unitId,'tiedBestRouteIds':tied,
        'interpretation':'Simulated patrol suggestions, not personal safety directions. Collision evidence is for visited stop cells, not every road segment, a unique route total, or a forecast. Missing counts are unknown, not zero. Windows are anchored to the cached dataset latest date.'},
        'source':'Cached NYC collision records / local historical ranks + OSRM road geometry'}
